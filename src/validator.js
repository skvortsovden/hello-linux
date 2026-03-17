'use strict';

const { exec }      = require('child_process');
const { promisify } = require('util');
const fs            = require('fs');
const { execSync }  = require('child_process');

const execAsync = promisify(exec);

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

/**
 * Run all `expected` checks for a session's lab inside its environment.
 * Returns { passed: boolean, results: Array<{ description, passed, error }> }
 */
async function validate(session) {
  const { lab, env, sessionId } = session;
  const checks = lab.expected || [];

  if (checks.length === 0) {
    console.log(`[validator] Session ${sessionId}: no checks defined — auto-pass`);
    return { passed: true, results: [] };
  }

  const results = [];
  let allPassed = true;

  for (const check of checks) {
    const { description = '(unnamed check)', check: command } = check;
    let passed = false;
    let error  = null;

    try {
      if (env.type === 'container') {
        await execAsync(`"${PODMAN_BIN}" exec "${env.containerId}" sh -c ${JSON.stringify(command)}`);
        passed = true;
      } else if (env.type === 'vm') {
        const agentCmd = JSON.stringify({
          execute: 'guest-exec',
          arguments: { path: '/bin/sh', arg: ['-c', command], 'capture-output': true },
        });
        const { stdout } = await execAsync(`"${VIRSH_BIN}" qemu-agent-command "${env.vmName}" '${agentCmd}'`);
        const resp = JSON.parse(stdout);
        const pid  = resp.return.pid;

        let statusResp;
        for (let i = 0; i < 10; i++) {
          await new Promise(r => setTimeout(r, 500));
          const statusCmd = JSON.stringify({ execute: 'guest-exec-status', arguments: { pid } });
          const { stdout: sOut } = await execAsync(`"${VIRSH_BIN}" qemu-agent-command "${env.vmName}" '${statusCmd}'`);
          statusResp = JSON.parse(sOut);
          if (statusResp.return.exited) break;
        }
        passed = statusResp?.return?.exitcode === 0;
      }
    } catch (err) {
      passed = false;
      // Only expose stderr output — never the raw error message, which
      // contains the full shell command (and therefore the check answer).
      error  = err.stderr?.trim() || null;
    }

    results.push({ description, passed, error: passed ? null : error });
    if (!passed) allPassed = false;
  }

  const verdict = allPassed ? 'PASS' : 'FAIL';
  console.log(`[validator] Session ${sessionId}: ${verdict} (${results.filter(r => r.passed).length}/${results.length} checks passed)`);

  return { passed: allPassed, results };
}

module.exports = { validate };
