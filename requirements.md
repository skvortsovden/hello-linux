# Requirements: hello-linux

**Document type:** Product Requirements  
**Version:** 1.3  
**Date:** 2026-03-18  
**Status:** Draft

---

## 1. Overview

**hello-linux** is a self-hosted, browser-based Linux learning platform. It presents a curated list of hands-on labs where a learner can read instructions, execute commands in a real terminal, and validate their solution — all from a web browser.

The platform runs entirely on the admin's local machine using Podman to provision isolated environments (containers or virtual machines) per lab. Labs are defined as human-readable YAML files, making the platform easy to extend and maintain without touching application code.

---

## 2. Personas

### 2.1 Learner
A person who wants to practice Linux skills interactively through guided, sandboxed labs.

### 2.2 Admin
A technically proficient person (developer, educator, sysadmin) who installs, runs, and maintains the platform. They can create or modify labs by editing YAML files and restarting the app.

---

## 3. User Stories

### Learner

| ID | Story |
|----|-------|
| U-01 | As a learner, I want to open the app in a web browser and see a list of available labs so I know what I can practice. |
| U-02 | As a learner, I want to click on a lab and be taken to a dedicated lab page so I can focus on that exercise. |
| U-03 | As a learner, I want to see clear instructions on the left side of the lab page so I know exactly what is expected of me. |
| U-04 | As a learner, I want to use an interactive terminal on the right side of the lab page so I can type and execute real Linux commands. |
| U-05 | As a learner, I want to click a "Check Solution" button so I can get immediate feedback on whether I completed the lab correctly. |
| U-06 | As a learner, I want to see a clear pass or fail result with a short explanation so I understand what went wrong or right. |
| U-07 | As a learner, I want the terminal to connect to an isolated environment so my actions do not affect the host machine or other labs. |

### Admin

| ID | Story |
|----|-------|
| A-01 | As an admin, I want to run the entire platform with a single command so setup is fast and reproducible. |
| A-02 | As an admin, I want to define each lab in a separate YAML file so I can add, remove, or edit labs without modifying application code. |
| A-03 | As an admin, I want to specify whether a lab uses a container or a virtual machine so I can choose the right level of isolation per exercise. |
| A-04 | As an admin, I want Podman (not Docker) to be used to provision container environments so I do not need a daemon or root privileges. |
| A-04b | As an admin, I want virt-manager / libvirt to be used on Linux to provision virtual machine environments so I get full OS-level isolation when a lab requires it. |
| A-05 | As an admin, I want lab environments to be automatically started when a learner opens a lab and stopped when they leave so resources are not wasted. |
| A-06 | As an admin, I want to define the initial state ("given") and the success criteria ("expected") for each lab in the YAML file so validation is declarative and version-controlled. |
| A-07 | As an admin, I want to define a lab with multiple containers or VMs in a shared network so I can create realistic multi-host scenarios (e.g. SSH between two machines, client-server setups). |

---

## 4. Functional Requirements

### 4.1 Lab List Page (Home)

- **FR-01** The home page (`/`) displays all available labs loaded from the YAML configuration directory.
- **FR-02** Each lab card shows: lab name, difficulty level badge, and short description. The environment type (container / VM) is not shown to the learner.
- **FR-03** Clicking a lab card navigates the user to the lab page at `/labs/:id`.
- **FR-04** The lab list is loaded dynamically from the backend at runtime (no hardcoding in frontend).

### 4.2 Lab Page

- **FR-05** The lab page uses a two-column layout:
  - **Left panel (~35% width):** Lab title with difficulty level badge, full description/instructions, optional collapsible solution, "Check Solution" button, and result feedback area.
  - **Right panel (~65% width):** Fully interactive terminal.
- **FR-06** When the lab page loads, the backend provisions a fresh isolated environment for that lab (container or VM).
- **FR-07** The terminal connects to that environment via WebSocket and provides a real interactive shell (stdin/stdout/stderr streaming).
- **FR-08** The terminal supports standard terminal emulation (cursor movement, colors, keyboard shortcuts, resize).
- **FR-09** When the learner navigates away from the lab page, the backend tears down the provisioned environment.

### 4.3 Solution Validation

- **FR-10** Clicking "Check Solution" sends a validation request to the backend for the current lab session.
- **FR-11** The backend runs the validation logic defined in the lab's YAML (`expected` section) inside the learner's provisioned environment.
- **FR-12** The backend returns a result: `pass` or `fail`, plus an optional short message.
- **FR-13** The frontend displays the result clearly (e.g., green success banner or red failure banner) without reloading the page.

### 4.4 Lab Configuration (YAML)

- **FR-14** Each lab is described in its own `.yaml` file stored in a designated `labs/` directory on the host.
- **FR-15** The YAML schema must support two layouts: **single-node** (backwards-compatible) and **multi-node**.

**Single-node layout** (existing):
```yaml
id: unique-lab-identifier          # string, unique, used in URL
name: "Lab Display Name"           # string
level: user                        # enum: user | admin | root — shown as a badge
description: |                     # multiline markdown: objective + hints only
  ## Objective
  Do something useful.
  ## Hints
  - A helpful tip.
solution: |                        # optional multiline markdown: step-by-step solution
  ## Steps                         # hidden by default, revealed on learner request
  1. Run this command...
type: container                    # enum: container | virtual-machine
image: ubuntu:24.04                # container image or cloud-init base image path
systemd: false                     # optional bool — run container with --systemd=always (PID 1 = systemd)
given:                             # setup commands run before the learner gets a shell
  - command: "mkdir /challenge"
expected:                          # validation checks — exit 0 = pass
  - description: "File must exist"
    check: "test -f /challenge/result.txt"
```

**Multi-node layout** (new — use when a lab requires more than one host):
```yaml
id: unique-lab-identifier
name: "Lab Display Name"
level: admin
description: |
  ## Objective
  Configure SSH key-based login between two hosts.
solution: |                        # optional
  ## Steps
  1. ...
nodes:
  - name: server                   # DNS hostname inside the shared lab network
    type: container                # enum: container | virtual-machine
    image: ubuntu:24.04
    systemd: false                 # optional
    primary: true                  # the terminal the learner interacts with
    given:
      - command: "apt-get install -y openssh-server"
  - name: client
    type: container
    image: ubuntu:24.04
    given:
      - command: "ssh-keygen -t ed25519 -f /root/.ssh/id_ed25519 -N ''"
expected:
  - description: "client can SSH into server without a password"
    node: client                   # optional — defaults to primary node if omitted
    check: "ssh -o StrictHostKeyChecking=no server 'echo ok'"
```

Rules:
- Exactly **one** node must have `primary: true`; this node's shell is exposed in the terminal.
- Node `name` values must be unique within a lab and are used as container/VM hostnames and DNS names within the shared network.
- `expected.node` is optional; when omitted the check runs on the primary node.
- A lab file must use either the flat single-node layout **or** the `nodes:` list — not both.

- **FR-16** The backend watches the `labs/` directory; changes to YAML files are reflected on next page load without restarting the server.
- **FR-17** All `expected.check` values are shell commands. The check passes if the exit code is `0`.
- **FR-18** Validation results must never expose the raw `check` shell command to the learner — only the human-readable `description` and any stderr output are shown.

### 4.5 Environment Provisioning

- **FR-19** For `type: container`, the backend uses Podman to run the specified image in a rootless container.
- **FR-20** For `type: virtual-machine`, the backend uses **virt-manager / libvirt** (`virsh`) to define, start, and destroy a VM. Linux hosts only.
- **FR-21** When `systemd: true` is set on a container lab, the container is started with `podman run --systemd=always`, making systemd the PID 1 process. This enables full `systemctl` / `journalctl` functionality inside the container.
- **FR-22** Before executing `given` commands the provisioner polls `podman inspect` until the container status is `running` (timeout: 30 s, interval: 500 ms), preventing race conditions on slow hosts.
- **FR-23** `given` setup commands are executed inside the environment automatically after provisioning and before the terminal is handed to the learner.
- **FR-24** Each lab session gets its own isolated environment instance (one container/VM per active session).
- **FR-25** Environments are cleaned up (stopped and removed) when the session ends or times out.

### 4.6 Session Management

- **FR-26** A session is created when a learner opens a lab page and destroyed when they navigate away or close the tab.
- **FR-27** Sessions have a configurable inactivity timeout (default: 30 minutes) after which the environment is torn down.
- **FR-28** The backend assigns a unique session ID per lab visit, used to route terminal WebSocket traffic and validation requests to the correct environment.

### 4.7 Solution Reveal

- **FR-29** If a lab YAML includes a `solution` field, a "Show Solution" button is displayed below the instructions in the left panel.
- **FR-30** The solution content is hidden by default and only revealed when the learner explicitly clicks the button.
- **FR-31** The button label toggles between "Show Solution" and "Hide Solution" to reflect current state.

### 4.8 Multi-Node Labs

- **FR-32** When a lab YAML contains a `nodes:` list, the provisioner starts **all** listed containers/VMs as part of a single session.
- **FR-33** All nodes in a multi-node lab are connected to a **dedicated Podman network** (or equivalent) created for that session. Container `name` values become DNS-resolvable hostnames within the network, enabling nodes to reach each other by name (e.g. `ssh server`, `ping client`).
- **FR-34** Exactly one node must be marked `primary: true`. The learner's interactive terminal is attached to this node by default. For multi-node labs, the terminal panel displays a **tab bar** with one tab per declared node, allowing the learner to switch between node shells. The primary node's tab is active on load.
- **FR-35** `given` setup commands defined on a non-primary node are executed on that node before the learner's shell is opened on the primary node.
- **FR-36** Validation checks that include a `node:` key are executed inside the specified node's environment. Checks without a `node:` key run on the primary node.
- **FR-37** Session teardown destroys **all** nodes and removes the shared network in a single cleanup operation.
- **FR-38** Single-node labs (flat YAML layout) continue to work unchanged; the provisioner treats them as a single-node case with no shared network.
- **FR-39** Environment provisioning is **asynchronous**. `POST /api/session` returns a `sessionId` immediately without waiting for provisioning to complete. The frontend polls `GET /api/session/:id/status` (returns `{ status: "pending" | "ready" | "error", message }`) and shows a spinner overlay until the session is `ready`. If provisioning fails, the overlay displays the error message.

---

## 5. Non-Functional Requirements

| ID | Category | Requirement |
|----|----------|-------------|
| NF-01 | Ease of Setup | The platform must be startable with a single command (e.g., `podman-compose up` or equivalent). |
| NF-02 | Dependencies | Host-level dependencies are **Podman** (for container labs) and **virt-manager / libvirt** (for VM labs, Linux only). No Docker daemon required. Rootless Podman is preferred; libvirt may require the admin user to be in the `libvirt` group. |
| NF-03 | Portability | Container labs must run on Linux and macOS (where Podman is supported). VM labs are Linux-only (virt-manager / libvirt). Labs with `type: virtual-machine` should be clearly marked in the UI when the host OS does not support them. |
| NF-04 | Maintainability | Adding or modifying a lab requires only editing a YAML file — no code changes. |
| NF-05 | Simplicity | The frontend must not require a build step for basic customization; plain HTML/CSS/JS or a minimal framework is preferred. |
| NF-06 | Performance | Terminal latency (keystroke to echo) must be under 200 ms on a local machine. |
| NF-07 | Isolation | Each learner session must be fully isolated; actions in one session must not affect another. |
| NF-08 | Security | Container/VM environments must not have access to host filesystem mounts or privileged capabilities by default. |
| NF-09 | Observability | Backend must log environment lifecycle events (start, stop, timeout, validation result) to stdout. |
| NF-10 | Extensibility | The validation system must support adding new check types (e.g., HTTP checks, file content checks) in the future with minimal refactoring. |

---

## 6. Technical Constraints

- **Container runtime:** Podman (rootless). Docker must not be required.
- **VM runtime:** virt-manager / libvirt (`virsh`, `virt-install`). Used exclusively for `type: virtual-machine` labs on Linux hosts. The backend interacts with libvirt via the `virsh` CLI or the `libvirt` Python/Node bindings.
- **Terminal protocol:** WebSocket-based PTY (pseudo-terminal) attached to the running container/VM shell.
- **Frontend terminal emulator:** Must use `xterm.js` (industry standard, supports full ANSI emulation).
- **Backend language:** Node.js or Python — agent's choice based on best fit for WebSocket + Podman CLI orchestration.
- **Lab files:** YAML, stored in `./labs/` relative to the project root, one file per lab.
- **No external database:** All state is in-memory or derived from YAML files. Persistence is not required in v1.
- **No authentication:** v1 is single-user / local use only. Auth is out of scope.

---

## 7. Architecture Overview

```
Browser
  │
  ├── GET /                              → Lab list page
  ├── GET /labs/:id                      → Lab page (instructions + terminal UI)
  ├── GET /api/labs                      → JSON list of labs
  ├── GET /api/labs/:id                  → Single lab metadata (incl. nodes[])
  ├── POST /api/session                  → Start provisioning; returns sessionId immediately
  ├── GET /api/session/:id/status        → Poll provisioning status (pending|ready|error)
  ├── POST /api/validate/:sessionId      → Run expected checks, return pass/fail
  ├── DELETE /api/session/:sessionId     → Tear down environment
  └── WS /ws/:sid?node=&cols=&rows=     → PTY stream (node= selects container in multi-node)

Backend (Node.js)
  │
  ├── Lab config loader   → Reads & watches ./labs/*.yaml
  ├── Session manager     → Creates/destroys sessions, manages async status, timeouts
  ├── Provisioner         → Calls Podman CLI to start/stop environments
  │     ├── podman run ...                      (single-node container)
  │     ├── podman network create / run×N       (multi-node: shared network + N containers)
  │     └── virsh / virt-install                (type: virtual-machine, Linux only)
  ├── PTY bridge          → Attaches WebSocket to container exec shell (node-aware)
  └── Validator           → Runs expected.check commands; routes to node: if specified

./labs/
  ├── 01-create-file.yaml
  ├── 04-hello-script.yaml
  └── ...
```

---

## 8. Lab Page Layout

```
┌──────────────────────────────────────────────────────────┐
│  hello-linux                              [← Back to Labs]│
├──────────────────┬───────────────────────────────────────┤
│  Lab Title       │                                       │
│                  │                                       │
│  Instructions    │         Terminal                      │
│  (Markdown)      │         (xterm.js)                    │
│                  │                                       │
│                  │                                       │
│                  │                                       │
│  ─────────────── │                                       │
│  [Check Solution]│                                       │
│                  │                                       │
│  ✅ Passed! /    │                                       │
│  ❌ Failed:      │                                       │
│  <message>       │                                       │
└──────────────────┴───────────────────────────────────────┘
```

---

## 9. Example Lab YAML Files

### `labs/01-create-file.yaml`
```yaml
id: create-file
name: "Create Your First File"
level: user
description: |
  ## Objective
  Create a file named `hello.txt` inside the `/challenge` directory.

  ## Hints
  - Use the `touch` command to create an empty file.
  - The full path should be `/challenge/hello.txt`.
solution: |
  ## Steps
  1. `cd /challenge`
  2. `touch hello.txt`
type: container
image: ubuntu:24.04
given:
  - command: "mkdir -p /challenge"
expected:
  - description: "/challenge/hello.txt must exist"
    check: "test -f /challenge/hello.txt"
```

### `labs/04-systemd-service.yaml` (systemd example)
```yaml
id: systemd-service
name: "Create a systemd Service"
level: admin
description: |
  ## Objective
  Write a script that prints `hello linux` every 5 seconds and wrap it in a systemd service.

  ## Hints
  - `systemctl is-active hello` prints `active` if the service is running.
  - `systemctl is-enabled hello` prints `enabled` if it starts on boot.
solution: |
  ## Steps
  1. Create `/challenge/hello.sh` with a `while true` loop and `chmod +x` it.
  2. Write `/etc/systemd/system/hello.service`.
  3. `systemctl daemon-reload && systemctl start hello && systemctl enable hello`
type: container
image: hello-linux/systemd-ubuntu:latest
systemd: true
given:
  - command: "mkdir -p /challenge"
expected:
  - description: "/challenge/hello.sh must exist and be executable"
    check: "test -x /challenge/hello.sh"
  - description: "hello service must be active"
    check: "systemctl is-active hello"
  - description: "hello service must be enabled"
    check: "systemctl is-enabled hello"
```

### `labs/07-ssh-key-login.yaml` (multi-node example)
```yaml
id: ssh-key-login
name: "SSH Key-Based Login"
level: admin
description: |
  ## Objective
  Configure the **server** host to accept SSH logins from **client** using
  an ED25519 key pair — no password.

  ## Hints
  - Generate the key pair on **client** with `ssh-keygen`.
  - Copy the public key to **server**'s `/root/.ssh/authorized_keys`.
  - The SSH daemon on **server** is already running.
  - From the **client** terminal: `ssh server` should drop you straight in.
solution: |
  ## Steps
  1. On client: `ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ''`
  2. On client: `ssh-copy-id -i ~/.ssh/id_ed25519.pub root@server`
nodes:
  - name: server
    type: container
    image: ubuntu:24.04
    primary: true
    given:
      - command: "apt-get update -qq && apt-get install -y openssh-server"
      - command: "service ssh start"
      - command: "mkdir -p /root/.ssh && chmod 700 /root/.ssh"
  - name: client
    type: container
    image: ubuntu:24.04
    given:
      - command: "apt-get update -qq && apt-get install -y openssh-client"
      - command: "ssh-keygen -t ed25519 -f /root/.ssh/id_ed25519 -N ''"
expected:
  - description: "SSH daemon is running on server"
    check: "pgrep -x sshd"
  - description: "client can log in to server without a password"
    node: client
    check: "ssh -o StrictHostKeyChecking=no -o BatchMode=yes server 'echo ok'"
```

---

## 10. Design & Visual Identity

### 10.1 Brand Colors

| Role | Hex | Usage |
|------|-----|-------|
| Background | `#1c1c1c` | Page background, terminal panel, surface base |
| Accent — Gold | `#d9a441` | Logo icon, buttons, active borders, spinner, links, card arrows |
| Accent — Amber | `#c97a40` | Hover / active states on all accent elements |

### 10.2 Color Application

- **Background (`#1c1c1c`):** Base for the page and terminal panel. Cards and side panels use slightly lighter tints (`#242424`, `#1f1f1f`) to create surface elevation without introducing new hues.
- **Gold (`#d9a441`):** Primary interactive color — used on the logo icon, "Check Solution" button, card hover borders, lab card arrows, and the loading spinner.
- **Amber (`#c97a40`):** Warm shift applied on hover/active to all gold elements, reinforcing interactivity.
- **Borders:** `#333333` — a quiet mid-tone derived from the background family, keeping UI chrome from competing with content.
- **Text:** `#e2e4ec` (primary) and `#8b8fa8` (secondary/dim) — chosen for sufficient contrast against all background surfaces.

### 10.3 Typography

- **UI font:** System font stack (`-apple-system`, `BlinkMacSystemFont`, `'Segoe UI'`, sans-serif) — zero-overhead, native feel.
- **Mono font:** `JetBrains Mono` → `Fira Code` → `Cascadia Code` → monospace — used in the terminal, code blocks, and terminal chrome labels.

### 10.4 Design Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| ND-01 | All interactive elements use `#d9a441` as their default accent color and `#c97a40` on hover/active. |
| ND-02 | Background surfaces are exclusively derived from the `#1c1c1c` family; no unrelated hues are introduced for elevation or depth. |
| ND-03 | All brand colors are defined as CSS custom properties in `:root` so a single variable change propagates globally — no build step required. |
| ND-04 | Contrast ratios between accent colors and their background surfaces must meet WCAG AA (≥ 4.5 : 1 for normal text, ≥ 3 : 1 for large text / UI components). |

---

## 11. Out of Scope (v1)

- User authentication or multi-user support
- Progress tracking or completion history
- Lab scoring or gamification
- Remote/cloud hosting
- Lab editor UI (YAML is edited manually)
- VM support on macOS (virt-manager / libvirt is Linux-only)
- Mobile browser support

---

## 12. Acceptance Criteria

| ID | Criteria |
|----|----------|
| AC-01 | Admin can start the platform with one command. |
| AC-02 | Home page displays all labs with name, level badge, and description preview. |
| AC-03 | Clicking a lab opens a page with a live terminal connected to a fresh isolated environment. |
| AC-04 | The left panel shows lab instructions rendered from the YAML `description` field (Markdown). |
| AC-05 | If a `solution` field is present, a hidden "Show Solution" toggle appears below the instructions. |
| AC-06 | Clicking "Check Solution" runs all `expected.check` commands and displays pass/fail — without revealing the check commands themselves. |
| AC-07 | Labs with `systemd: true` start a container with systemd as PID 1; `systemctl` and `journalctl` work inside the terminal. |
| AC-08 | Adding a new `.yaml` file to `labs/` causes it to appear in the lab list without restarting the server. |
| AC-09 | Navigating away from a lab tears down the Podman container/VM. |
| AC-10 | Two concurrent learner sessions for the same lab run in completely separate containers. |
| AC-11 | All `given` setup commands run successfully before the learner's shell is ready. |
| AC-12 | The platform requires no host dependency other than Podman (container labs) and optionally virt-manager / libvirt (VM labs on Linux). |
| AC-13 | A multi-node lab provisions all declared nodes, connects them to a shared network, and tears all of them down together when the session ends. |
| AC-14 | Nodes in a multi-node lab can resolve each other by `name` over the shared network (e.g. `ping client` from the server node succeeds). |
| AC-15 | Validation checks with `node: <name>` run inside the specified node's environment; checks without `node:` run on the primary node. |
| AC-16 | For multi-node labs, the terminal panel displays a tab bar with one tab per node; clicking a tab switches the active shell. |
| AC-17 | `POST /api/session` returns a session ID immediately; a spinner overlay is shown while the backend provisions the environment. The overlay disappears only once the status endpoint reports `ready`. |
