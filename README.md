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

### Single-node lab

```yaml
id: my-lab-id           # used in URL: /labs/my-lab-id
name: "My Lab Name"
level: user             # user | admin | root (shown as a badge)
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

### Multi-node lab (two or more containers on a shared network)

```yaml
id: my-multi-lab
name: "My Multi-Node Lab"
level: admin
description: |
  ## Objective
  Do something across two hosts.
nodes:
  - name: server          # becomes the container hostname + DNS name
    type: container
    image: ubuntu:24.04
    primary: true         # this node's shell is shown in the terminal
    given:
      - command: "apt-get install -y openssh-server && /usr/sbin/sshd"
  - name: client
    type: container
    image: ubuntu:24.04
    given:
      - command: "ssh-keygen -t ed25519 -N '' -f /root/.ssh/id_ed25519"
expected:
  - description: "sshd is running on server"
    check: "pgrep -x sshd"          # runs on primary node by default
  - description: "client can SSH in"
    node: client                     # run this check on the 'client' node
    check: "ssh -o BatchMode=yes -o StrictHostKeyChecking=no root@server 'echo ok'"
```

For multi-node labs the terminal shows a **tab bar** — one tab per node — so learners can switch between hosts.

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
  ├── GET  /                              → Lab list (index.html)
  ├── GET  /labs/:id                      → Lab page (lab.html)
  ├── GET  /api/labs                      → JSON list of labs
  ├── GET  /api/labs/:id                  → Single lab metadata (incl. nodes[])
  ├── POST /api/session                   → Start provisioning, return sessionId immediately
  ├── GET  /api/session/:id/status        → Poll provisioning status (pending|ready|error)
  ├── POST /api/validate/:sid             → Run expected checks, return pass/fail
  ├── DELETE /api/session/:sid            → Tear down environment
  └── WS   /ws/:sid?node=&cols=&rows=    → PTY stream (xterm.js ↔ node-pty ↔ podman exec)
                                            node= selects which container in multi-node labs

src/
  ├── server.js         Express + WebSocket routing
  ├── labLoader.js      YAML parser + chokidar file watcher
  ├── sessionManager.js Session lifecycle & inactivity timeout
  ├── provisioner.js    podman run / virsh / multi-node network provisioning
  ├── ptyBridge.js      WebSocket ↔ node-pty ↔ container shell (node-aware)
  └── validator.js      Runs expected.check commands, supports node: routing

labs/                   One .yaml file per lab
public/                 Static frontend (no build step)
```

---

## Project Structure

```
hello-linux/
├── labs/
│   ├── 01-create-file.yaml          (user)
│   ├── 04-hello-script.yaml         (user)
│   ├── 04-systemd-service.yaml      (admin)
│   ├── 05-socket-activation.yaml    (root)
│   ├── 06-ssh-server.yaml           (admin)
│   └── 07-ssh-key-login.yaml        (admin, multi-node)
├── public/
│   ├── index.html      (lab list)
│   ├── lab.html        (lab page + terminal + tab bar)
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