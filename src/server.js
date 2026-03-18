'use strict';

const express    = require('express');
const http       = require('http');
const WebSocket  = require('ws');
const path       = require('path');
const os         = require('os');

const labLoader        = require('./labLoader');
const { createSession, getSession, destroySession } = require('./sessionManager');
const { attachPty }    = require('./ptyBridge');
const { validate }     = require('./validator');

const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Initialize lab loader (reads YAML + starts file watcher)
labLoader.init();

// ---------------------------------------------------------------------------
// REST API
// ---------------------------------------------------------------------------

/** GET /api/labs — list all available labs */
app.get('/api/labs', (_req, res) => {
  const list = Array.from(labLoader.labs.values()).map(lab => {
    const primaryNode = lab.nodes.find(n => n.primary) || lab.nodes[0];
    return {
      id:          lab.id,
      name:        lab.name,
      description: lab.description,
      type:        primaryNode.type,
      level:       lab.level,
    };
  });
  res.json(list);
});

/** GET /api/labs/:id — single lab details */
app.get('/api/labs/:id', (req, res) => {
  const lab = labLoader.labs.get(req.params.id);
  if (!lab) return res.status(404).json({ error: 'Lab not found' });
  const primaryNode = lab.nodes.find(n => n.primary) || lab.nodes[0];
  res.json({
    id:          lab.id,
    name:        lab.name,
    description: lab.description,
    solution:    lab.solution,
    level:       lab.level,
    image:       primaryNode.image,
    nodes:       lab.nodes.map(n => ({ name: n.name, primary: !!n.primary })),
  });
});

/** POST /api/session — create session (provisioning runs in background) */
app.post('/api/session', async (req, res) => {
  const { labId } = req.body;
  if (!labId) return res.status(400).json({ error: '"labId" is required' });

  const lab = labLoader.labs.get(labId);
  if (!lab) return res.status(404).json({ error: `Lab "${labId}" not found` });

  if (lab.nodes.some(n => n.type === 'virtual-machine') && os.platform() !== 'linux') {
    return res.status(400).json({
      error: 'VM labs require a Linux host with virt-manager/libvirt installed.',
    });
  }

  try {
    const session = await createSession(lab);
    // Return immediately — provisioning continues in background
    res.json({ sessionId: session.sessionId });
  } catch (err) {
    console.error('[server] Session creation failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/session/:sessionId/status — poll provisioning state */
app.get('/api/session/:sessionId/status', (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({ status: session.status, message: session.statusMsg || '' });
});

/** DELETE /api/session/:sessionId — tear down session */
app.delete('/api/session/:sessionId', async (req, res) => {
  await destroySession(req.params.sessionId);
  res.json({ ok: true });
});

/**
 * POST /api/session/:sessionId/destroy
 * Same as DELETE but reachable via navigator.sendBeacon (which sends POST).
 */
app.post('/api/session/:sessionId/destroy', async (req, res) => {
  await destroySession(req.params.sessionId);
  res.json({ ok: true });
});

/** POST /api/validate/:sessionId — run expected checks */
app.post('/api/validate/:sessionId', async (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  try {
    const result = await validate(session);
    res.json(result);
  } catch (err) {
    console.error('[server] Validation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Serve lab.html for any /labs/:id path (client-side JS reads the URL) */
app.get('/labs/:id', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'lab.html'));
});

// ---------------------------------------------------------------------------
// HTTP + WebSocket server
// ---------------------------------------------------------------------------

const server = http.createServer(app);
const wss    = new WebSocket.Server({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url   = new URL(req.url, `http://${req.headers.host}`);
  const match = url.pathname.match(/^\/ws\/([0-9a-f-]+)$/i);

  if (!match) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  const sessionId = match[1];
  const cols     = parseInt(url.searchParams.get('cols')) || 80;
  const rows     = parseInt(url.searchParams.get('rows')) || 24;
  const nodeName = url.searchParams.get('node') || null;

  wss.handleUpgrade(req, socket, head, ws => {
    const session = getSession(sessionId);
    if (!session) {
      ws.close(1008, 'Session not found');
      return;
    }
    if (session.status !== 'ready') {
      ws.close(1013, 'Session not ready yet');
      return;
    }
    session.ws = ws;
    console.log(`[server] WebSocket connected for session ${sessionId}${nodeName ? ` (node: ${nodeName})` : ''}`);
    attachPty(session, ws, cols, rows, nodeName);
  });
});

server.listen(PORT, () => {
  console.log(`\n  hello-linux is running → http://localhost:${PORT}\n`);
});
