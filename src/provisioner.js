'use strict';

const { exec }    = require('child_process');
const { promisify } = require('util');
const os            = require('os');
const fs            = require('fs');
const path          = require('path');
const { execSync }  = require('child_process');

const execAsync = promisify(exec);

const IS_LINUX   = os.platform() === 'linux';
const PROJECT_ROOT = path.resolve(__dirname, '..');

const { CONTAINER_BIN, VIRSH_BIN } = require('./containerBin');

// Keep PODMAN_BIN as an alias so existing code below needs no changes
const PODMAN_BIN = CONTAINER_BIN;

// ---------------------------------------------------------------------------
// Image management
// ---------------------------------------------------------------------------

/**
 * Build a local image from a Dockerfile if it doesn't already exist.
 * @param {string} imageName  - local tag, e.g. "hello-linux/systemd-ubuntu:latest"
 * @param {string} dockerfilePath - path relative to project root
 */
async function ensureImage(imageName, dockerfilePath) {
  // Check if the image already exists locally (works with both podman and docker)
  try {
    await execAsync(`"${PODMAN_BIN}" image inspect "${imageName}"`);
    console.log(`[provisioner] Image "${imageName}" already exists — skipping build`);
    return;
  } catch (_) {}

  const absDockerfile = path.resolve(PROJECT_ROOT, dockerfilePath);
  if (!fs.existsSync(absDockerfile)) {
    throw new Error(`Dockerfile not found: ${absDockerfile}`);
  }

  console.log(`[provisioner] Building image "${imageName}" from ${dockerfilePath} ...`);
  await execAsync(
    `"${PODMAN_BIN}" build -t "${imageName}" -f "${absDockerfile}" "${PROJECT_ROOT}"`,
    { maxBuffer: 10 * 1024 * 1024 }
  );
  console.log(`[provisioner] Image "${imageName}" built successfully`);
}

// ---------------------------------------------------------------------------
// Container provisioning (Podman, rootless)
// ---------------------------------------------------------------------------

/** Poll until the container reports status "running", or throw after timeout. */
async function waitUntilRunning(containerName, timeoutMs = 30000, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { stdout } = await execAsync(
        `"${PODMAN_BIN}" inspect --format '{{.State.Status}}' "${containerName}"`
      );
      if (stdout.trim() === 'running') return;
    } catch (_) {}
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Container "${containerName}" did not reach running state within ${timeoutMs}ms`);
}

async function provisionContainer(image, givenCommands, containerName, { systemd = false, dockerfile = null, privileged = false, sysctls = [] } = {}) {
  console.log(`[provisioner] Starting container "${containerName}" (image: ${image})`);

  if (dockerfile) {
    await ensureImage(image, dockerfile);
  }

  const sysctlFlags = sysctls.map(s => `--sysctl "${s}"`).join(' ');
  const runCmd = systemd
    ? `"${PODMAN_BIN}" run -d --name "${containerName}" --systemd=always "${image}"`
    : privileged
      ? `"${PODMAN_BIN}" run -d --name "${containerName}" --privileged ${sysctlFlags} "${image}" sleep 3600`.trim()
      : `"${PODMAN_BIN}" run -d --name "${containerName}" --security-opt no-new-privileges:true ${sysctlFlags} "${image}" sleep 3600`.trim();

  await execAsync(runCmd);
  console.log(`[provisioner] Container started: ${containerName}`);

  console.log(`[provisioner] Waiting for container "${containerName}" to be running...`);
  await waitUntilRunning(containerName);
  console.log(`[provisioner] Container "${containerName}" is running`);

  for (const step of (givenCommands || [])) {
    if (!step.command) continue;
    console.log(`[provisioner]   given: ${step.command}`);
    await execAsync(`"${PODMAN_BIN}" exec "${containerName}" sh -c ${JSON.stringify(step.command)}`);
  }

  console.log(`[provisioner] Container ready: ${containerName}`);
  return { type: 'container', containerId: containerName };
}

async function destroyContainer(containerName) {
  console.log(`[provisioner] Destroying container: ${containerName}`);
  try { await execAsync(`"${PODMAN_BIN}" stop "${containerName}"`); }  catch (_) { /* already stopped */ }
  try { await execAsync(`"${PODMAN_BIN}" rm -f "${containerName}"`); } catch (_) { /* already gone */ }
  console.log(`[provisioner] Container destroyed: ${containerName}`);
}

// ---------------------------------------------------------------------------
// VM provisioning (virt-manager / libvirt) — Linux only
// ---------------------------------------------------------------------------

async function provisionVM(image, givenCommands, vmName) {
  if (!IS_LINUX) {
    throw new Error('VM labs require a Linux host with virt-manager/libvirt installed.');
  }
  console.log(`[provisioner] Starting VM "${vmName}" (base image: ${image})`);

  // Copy the disk image so each session has its own copy
  const diskPath = `/tmp/${vmName}.qcow2`;
  await execAsync(`cp "${image}" "${diskPath}"`);

  // Define and start the VM
  const cmd = [
    'virt-install',
    `--name "${vmName}"`,
    '--memory 512',
    '--vcpus 1',
    `--disk path=${diskPath},format=qcow2`,
    '--import',
    '--os-variant generic',
    '--noautoconsole',
    '--graphics none',
    '--serial pty',
  ].join(' ');
  await execAsync(cmd);

  // Allow time for the VM to boot
  console.log(`[provisioner] Waiting for VM "${vmName}" to boot...`);
  await new Promise(r => setTimeout(r, 15000));

  // Run given commands via QEMU guest agent
  for (const step of (givenCommands || [])) {
    if (!step.command) continue;
    console.log(`[provisioner]   given (VM): ${step.command}`);
    const agentCmd = JSON.stringify({
      execute: 'guest-exec',
      arguments: { path: '/bin/sh', arg: ['-c', step.command], 'capture-output': true },
    });
    await execAsync(`virsh qemu-agent-command "${vmName}" '${agentCmd}'`);
  }

  console.log(`[provisioner] VM ready: ${vmName}`);
  return { type: 'vm', vmName, diskPath };
}

async function destroyVM(vmName, diskPath) {
  console.log(`[provisioner] Destroying VM: ${vmName}`);
  try { await execAsync(`"${VIRSH_BIN}" destroy "${vmName}"`); }           catch (_) {}
  try { await execAsync(`"${VIRSH_BIN}" undefine "${vmName}" --remove-all-storage`); } catch (_) {}
  try { await execAsync(`rm -f "${diskPath}"`); }                 catch (_) {}
  console.log(`[provisioner] VM destroyed: ${vmName}`);
}

// ---------------------------------------------------------------------------
// Multi-node provisioning (shared Podman network)
// ---------------------------------------------------------------------------

/**
 * Provision multiple containers on a dedicated Podman network.
 * @param {Array}  nodes         - array of node definitions from lab YAML
 * @param {string} sessionPrefix - unique prefix for container/network names
 * @returns {{ type: 'multi', network: string, nodes: Array }}
 */
async function provisionMultiNode(nodes, sessionPrefix) {
  const networkName = `${sessionPrefix}-net`;

  // Create a dedicated network so nodes can resolve each other by hostname
  await execAsync(`"${PODMAN_BIN}" network create "${networkName}"`);
  console.log(`[provisioner] Network created: ${networkName}`);

  const containerNames = [];

  // 1. Start all containers (non-blocking — we wait below)
  for (const node of nodes) {
    const containerName = `${sessionPrefix}-${node.name}`;
    containerNames.push(containerName);

    if (node.dockerfile) {
      await ensureImage(node.image, node.dockerfile);
    }

    const nodeSysctlFlags = (node.sysctls || []).map(s => `--sysctl "${s}"`).join(' ');
    const runCmd = node.systemd
      ? `"${PODMAN_BIN}" run -d --name "${containerName}" --hostname "${node.name}" --network "${networkName}" --systemd=always "${node.image}"`
      : node.privileged
        ? `"${PODMAN_BIN}" run -d --name "${containerName}" --hostname "${node.name}" --network "${networkName}" --privileged ${nodeSysctlFlags} "${node.image}" sleep 3600`.trim()
        : `"${PODMAN_BIN}" run -d --name "${containerName}" --hostname "${node.name}" --network "${networkName}" --security-opt no-new-privileges:true ${nodeSysctlFlags} "${node.image}" sleep 3600`.trim();

    await execAsync(runCmd);
    console.log(`[provisioner] Started node "${node.name}" → container "${containerName}"`);
  }

  // 2. Wait for all containers to reach 'running' in parallel
  await Promise.all(containerNames.map(name => waitUntilRunning(name)));
  console.log(`[provisioner] All nodes running`);

  // 3. Run given commands on each node sequentially (order may matter)
  const provisionedNodes = [];
  for (let i = 0; i < nodes.length; i++) {
    const node          = nodes[i];
    const containerName = containerNames[i];

    for (const step of (node.given || [])) {
      if (!step.command) continue;
      console.log(`[provisioner]   given [${node.name}]: ${step.command}`);
      await execAsync(
        `"${PODMAN_BIN}" exec "${containerName}" sh -c ${JSON.stringify(step.command)}`,
        { maxBuffer: 10 * 1024 * 1024 }
      );
    }

    provisionedNodes.push({
      name:        node.name,
      containerId: containerName,
      primary:     !!node.primary,
    });
  }

  const primaryNode = provisionedNodes.find(n => n.primary);
  if (!primaryNode) throw new Error('Multi-node lab must have exactly one node with primary: true');

  console.log(`[provisioner] Multi-node ready — network: ${networkName}, primary: ${primaryNode.name}`);
  return { type: 'multi', network: networkName, nodes: provisionedNodes };
}

/**
 * Destroy all containers in a multi-node environment and remove the shared network.
 * @param {{ network: string, nodes: Array }} env
 */
async function destroyMultiNode(env) {
  console.log(`[provisioner] Destroying multi-node environment (network: ${env.network})`);

  // Stop + remove all nodes in parallel
  await Promise.allSettled(env.nodes.map(async node => {
    try { await execAsync(`"${PODMAN_BIN}" stop "${node.containerId}"`); } catch (_) {}
    try { await execAsync(`"${PODMAN_BIN}" rm -f "${node.containerId}"`); } catch (_) {}
    console.log(`[provisioner] Node "${node.name}" destroyed`);
  }));

  // Remove the shared network
  try { await execAsync(`"${PODMAN_BIN}" network rm -f "${env.network}"`); } catch (_) {}
  console.log(`[provisioner] Network ${env.network} removed`);
}

module.exports = { provisionContainer, destroyContainer, provisionVM, destroyVM, provisionMultiNode, destroyMultiNode, IS_LINUX };
