'use strict';

const { exec }    = require('child_process');
const { promisify } = require('util');
const os            = require('os');
const fs            = require('fs');
const { execSync }  = require('child_process');

const execAsync = promisify(exec);

const IS_LINUX = os.platform() === 'linux';

function resolveBin(name) {
  try {
    return execSync(`which ${name}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (_) {}
  for (const prefix of ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']) {
    const p = `${prefix}/${name}`;
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch (_) {}
  }
  return name;
}

const PODMAN_BIN = resolveBin('podman');
const VIRSH_BIN  = resolveBin('virsh');
console.log(`[provisioner] podman → ${PODMAN_BIN}`);

// ---------------------------------------------------------------------------
// Container provisioning (Podman, rootless)
// ---------------------------------------------------------------------------

async function provisionContainer(image, givenCommands, containerName, { systemd = false } = {}) {
  console.log(`[provisioner] Starting container "${containerName}" (image: ${image})`);

  const runCmd = systemd
    ? `"${PODMAN_BIN}" run -d --name "${containerName}" --systemd=always "${image}"`
    : `"${PODMAN_BIN}" run -d --name "${containerName}" --security-opt no-new-privileges:true "${image}" sleep infinity`;

  await execAsync(runCmd);
  console.log(`[provisioner] Container started: ${containerName}`);

  if (systemd) {
    // Wait for systemd to finish its startup sequence before running given commands
    console.log(`[provisioner] Waiting for systemd to initialize in ${containerName}...`);
    await new Promise(r => setTimeout(r, 3000));
  }

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

module.exports = { provisionContainer, destroyContainer, provisionVM, destroyVM, IS_LINUX };
