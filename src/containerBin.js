'use strict';

/**
 * Shared container/VM binary resolution.
 * Tries podman first (preferred for rootless), falls back to docker.
 * This allows the app to run both natively (with Podman) and inside a
 * Docker container (with the host Docker socket mounted).
 */

const fs       = require('fs');
const { execSync } = require('child_process');

function resolveBin(name) {
  try {
    const p = execSync(`which ${name}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (p) return p;
  } catch (_) {}
  for (const prefix of ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']) {
    const p = `${prefix}/${name}`;
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch (_) {}
  }
  return null;
}

// Prefer podman, fall back to docker
const CONTAINER_BIN = resolveBin('podman') || resolveBin('docker') || 'docker';
const VIRSH_BIN     = resolveBin('virsh') || 'virsh';

console.log(`[containerBin] container tool → ${CONTAINER_BIN}`);

module.exports = { CONTAINER_BIN, VIRSH_BIN };
