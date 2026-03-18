'use strict';

const { v4: uuidv4 } = require('uuid');
const os = require('os');
const {
  provisionContainer, destroyContainer,
  provisionVM,        destroyVM,
  provisionMultiNode, destroyMultiNode,
} = require('./provisioner');

const INACTIVITY_TIMEOUT_MS = (process.env.SESSION_TIMEOUT_MINUTES || 30) * 60 * 1000;

/** Map of sessionId → session object */
const sessions = new Map();

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

async function createSession(lab) {
  const sessionId   = uuidv4();
  const envName     = `hello-linux-${sessionId.slice(0, 8)}`;

  console.log(`[sessionManager] Creating session ${sessionId} for lab "${lab.id}"`);

  const session = {
    sessionId,
    labId:     lab.id,
    lab,
    env:       null,
    status:    'pending',   // 'pending' | 'ready' | 'error'
    statusMsg: 'Provisioning…',
    createdAt: Date.now(),
    ws:        null,
    pty:       null,
    _timeout:  null,
  };

  sessions.set(sessionId, session);
  resetTimeout(session);

  // Provision in background — caller gets sessionId immediately
  (async () => {
    try {
      let env;
      if (lab.nodes && lab.nodes.length > 0) {
        env = await provisionMultiNode(lab.nodes, envName);
      } else if (lab.type === 'container') {
        env = await provisionContainer(lab.image, lab.given, envName, {
          systemd:    !!lab.systemd,
          dockerfile: lab.dockerfile || null,
        });
      } else if (lab.type === 'virtual-machine') {
        if (os.platform() !== 'linux') {
          throw new Error('VM labs require a Linux host with virt-manager/libvirt.');
        }
        env = await provisionVM(lab.image, lab.given, envName);
      } else {
        throw new Error(`Unknown lab type: "${lab.type}"`);
      }
      session.env    = env;
      session.status = 'ready';
      console.log(`[sessionManager] Session ${sessionId} ready`);
    } catch (err) {
      session.status    = 'error';
      session.statusMsg = err.message;
      console.error(`[sessionManager] Session ${sessionId} provisioning failed: ${err.message}`);
    }
  })();

  return session;
}

// ---------------------------------------------------------------------------
// Destroy
// ---------------------------------------------------------------------------

async function destroySession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  clearTimeout(session._timeout);

  // Kill PTY
  if (session.pty) {
    try { session.pty.kill(); } catch (_) {}
  }

  // Close WebSocket
  if (session.ws && session.ws.readyState === 1 /* OPEN */) {
    try { session.ws.close(); } catch (_) {}
  }

  // Tear down environment
  try {
    if (session.env.type === 'container') {
      await destroyContainer(session.env.containerId);
    } else if (session.env.type === 'multi') {
      await destroyMultiNode(session.env);
    } else if (session.env.type === 'vm') {
      await destroyVM(session.env.vmName, session.env.diskPath);
    }
  } catch (err) {
    console.error(`[sessionManager] Error destroying environment for ${sessionId}: ${err.message}`);
  }

  sessions.delete(sessionId);
  console.log(`[sessionManager] Session ${sessionId} destroyed`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

function resetTimeout(session) {
  clearTimeout(session._timeout);
  session._timeout = setTimeout(() => {
    console.log(`[sessionManager] Session ${session.sessionId} timed out after inactivity`);
    destroySession(session.sessionId);
  }, INACTIVITY_TIMEOUT_MS);
}

module.exports = { sessions, createSession, getSession, destroySession, resetTimeout };
