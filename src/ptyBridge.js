'use strict';

const pty              = require('node-pty');
const { resetTimeout } = require('./sessionManager');
const { CONTAINER_BIN, VIRSH_BIN } = require('./containerBin');

const PODMAN_BIN = CONTAINER_BIN;
console.log(`[ptyBridge] container tool → ${PODMAN_BIN}`);

/**
 * Attach a node-pty process to a WebSocket for a given session.
 * Protocol (JSON frames over WebSocket):
 *   Server → Client: { type: 'data', data: '<string>' }
 *                    { type: 'exit', exitCode: <number> }
 *   Client → Server: { type: 'input',  data: '<string>' }
 *                    { type: 'resize', cols: <n>, rows: <n> }
 */
function attachPty(session, ws, cols = 80, rows = 24, nodeName = null) {
  const { env } = session;

  let ptyProcess;

  if (env.type === 'container') {
    ptyProcess = pty.spawn(
      '/bin/sh',
      ['-c', `exec "${PODMAN_BIN}" exec -it "${env.containerId}" /bin/bash`],
      {
        name: 'xterm-256color',
        cols,
        rows,
        cwd:  process.env.HOME || '/',
        env:  { ...process.env, TERM: 'xterm-256color' },
      }
    );
  } else if (env.type === 'multi') {
    const targetNode = nodeName
      ? env.nodes.find(n => n.name === nodeName)
      : env.nodes.find(n => n.primary);
    if (!targetNode) {
      ws.send(JSON.stringify({ type: 'data', data: `\r\nError: node "${nodeName}" not found in this session\r\n` }));
      return;
    }
    ptyProcess = pty.spawn(
      '/bin/sh',
      ['-c', `exec "${PODMAN_BIN}" exec -it "${targetNode.containerId}" /bin/bash`],
      {
        name: 'xterm-256color',
        cols,
        rows,
        cwd:  process.env.HOME || '/',
        env:  { ...process.env, TERM: 'xterm-256color' },
      }
    );
  } else if (env.type === 'vm') {
    ptyProcess = pty.spawn(
      '/bin/sh',
      ['-c', `exec "${VIRSH_BIN}" console "${env.vmName}"`],
      {
        name: 'xterm-256color',
        cols,
        rows,
        cwd:  process.env.HOME || '/',
        env:  { ...process.env, TERM: 'xterm-256color' },
      }
    );
  } else {
    ws.send(JSON.stringify({ type: 'data', data: 'Error: unknown environment type\r\n' }));
    return;
  }

  session.pty = ptyProcess;
  console.log(`[ptyBridge] PTY attached for session ${session.sessionId} (pid ${ptyProcess.pid})`);

  // PTY → WebSocket
  ptyProcess.onData(data => {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(JSON.stringify({ type: 'data', data }));
      resetTimeout(session);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    console.log(`[ptyBridge] PTY exited (session ${session.sessionId}, code ${exitCode})`);
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'exit', exitCode }));
    }
  });

  // WebSocket → PTY
  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'input') {
        ptyProcess.write(msg.data);
        resetTimeout(session);
      } else if (msg.type === 'resize') {
        const c = parseInt(msg.cols) || 80;
        const r = parseInt(msg.rows) || 24;
        ptyProcess.resize(c, r);
      }
    } catch (_) {
      // Fallback: treat as raw input
      ptyProcess.write(raw.toString());
    }
  });

  ws.on('close', () => {
    console.log(`[ptyBridge] WebSocket closed for session ${session.sessionId}`);
    try { ptyProcess.kill(); } catch (_) {}
  });

  ws.on('error', err => {
    console.error(`[ptyBridge] WebSocket error for session ${session.sessionId}:`, err.message);
    try { ptyProcess.kill(); } catch (_) {}
  });
}

module.exports = { attachPty };
