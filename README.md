# hello-linux

A **self-hosted, browser-based Linux learning platform**. Learners read lab instructions, type real Linux commands in an in-browser terminal, and validate their work — all powered by isolated Podman containers running on your local machine.

---

## Prerequisites

| Dependency | Purpose | Install |
|---|---|---|
| **Node.js ≥ 18** | Runs the server | [nodejs.org](https://nodejs.org) |
| **Podman** | Provisions container labs | `brew install podman` (macOS) / `apt install podman` (Linux) |
| **Build tools** | Compiles `node-pty` (native addon) | `xcode-select --install` (macOS) / `apt install build-essential python3` (Linux) |
| **virt-manager / libvirt** | VM labs only, Linux hosts only | `apt install virt-manager` |

> **macOS users:** after installing Podman run `podman machine init && podman machine start` once.

---

## Quick Start

```bash
git clone https://github.com/your-org/hello-linux
cd hello-linux
npm install
npm start
```

Open **http://localhost:3000** in your browser.

---

## Adding Labs

Drop a `.yaml` file into the `labs/` directory — no server restart needed (the server watches for changes).

Minimal lab schema:

```yaml
id: my-lab-id           # used in URL: /labs/my-lab-id
name: "My Lab Name"
level: junior           # junior | medior | senior (shown as a badge)
description: |          # Markdown, shown in the left panel
  ## Objective
  Do something useful.
type: container          # container | virtual-machine
image: ubuntu:24.04      # container image or VM base image path
given:                   # setup commands run before the learner gets a shell
  - command: "mkdir -p /challenge"
expected:                # validation checks (exit 0 = pass)
  - description: "File must exist"
    check: "test -f /challenge/result.txt"
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `SESSION_TIMEOUT_MINUTES` | `30` | Inactivity timeout before environment teardown |

---

## Architecture

```
Browser
  ├── GET  /                        → Lab list (index.html)
  ├── GET  /labs/:id                → Lab page (lab.html)
  ├── GET  /api/labs                → JSON list of labs
  ├── POST /api/session             → Provision environment, return sessionId
  ├── POST /api/validate/:sid       → Run expected checks, return pass/fail
  ├── DELETE /api/session/:sid      → Tear down environment
  └── WS   /ws/:sid?cols=&rows=    → PTY stream (xterm.js ↔ node-pty ↔ podman exec)

src/
  ├── server.js         Express + WebSocket routing
  ├── labLoader.js      YAML parser + chokidar file watcher
  ├── sessionManager.js Session lifecycle & inactivity timeout
  ├── provisioner.js    podman run / virsh provisioning
  ├── ptyBridge.js      WebSocket ↔ node-pty ↔ container shell
  └── validator.js      Runs expected.check commands, returns pass/fail

labs/                   One .yaml file per lab
public/                 Static frontend (no build step)
```

---

## Project Structure

```
hello-linux/
├── labs/
│   ├── 01-create-file.yaml
│   ├── 02-file-permissions.yaml
│   └── 03-write-to-file.yaml
├── public/
│   ├── index.html      (lab list)
│   ├── lab.html        (lab page + terminal)
│   └── style.css
├── src/
│   ├── server.js
│   ├── labLoader.js
│   ├── sessionManager.js
│   ├── provisioner.js
│   ├── ptyBridge.js
│   └── validator.js
├── package.json
└── README.md
```

---

## License

See [LICENSE](LICENSE).