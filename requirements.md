# Requirements: hello-linux

**Document type:** Product Requirements  
**Version:** 1.0  
**Date:** 2026-03-16  
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

---

## 4. Functional Requirements

### 4.1 Lab List Page (Home)

- **FR-01** The home page (`/`) displays all available labs loaded from the YAML configuration directory.
- **FR-02** Each lab card shows: lab name, short description, and environment type badge (`container` or `virtual-machine`).
- **FR-03** Clicking a lab card navigates the user to the lab page at `/labs/:id`.
- **FR-04** The lab list is loaded dynamically from the backend at runtime (no hardcoding in frontend).

### 4.2 Lab Page

- **FR-05** The lab page uses a two-column layout:
  - **Left panel (~35% width):** Lab title, full description/instructions, "Check Solution" button, and result feedback area.
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
- **FR-15** The YAML schema must include the following fields:

```yaml
id: unique-lab-identifier          # string, unique, used in URL
name: "Lab Display Name"           # string
description: |                     # multiline markdown string shown in left panel
  Instructions for the learner...
type: container                    # enum: container | virtual-machine
image: ubuntu:24.04                # container image (type: container) or cloud-init base image path (type: virtual-machine)
given:                             # setup steps run before the learner gets a shell
  - command: "useradd student"
  - command: "mkdir /challenge"
expected:                          # validation steps run when "Check Solution" is clicked
  - description: "File /challenge/hello.txt must exist"
    check: "test -f /challenge/hello.txt"
  - description: "File must contain the word 'hello'"
    check: "grep -q 'hello' /challenge/hello.txt"
```

- **FR-16** The backend watches the `labs/` directory; changes to YAML files are reflected on next page load without restarting the server.
- **FR-17** All `expected.check` values are shell commands. The check passes if the exit code is `0`.

### 4.5 Environment Provisioning

- **FR-18** For `type: container`, the backend uses Podman to run the specified image in a rootless container.
- **FR-19** For `type: virtual-machine`, the backend uses **virt-manager / libvirt** (via the `virsh` CLI or `libvirt` API) to define, start, and destroy a VM based on the specified base image. The lab YAML may optionally specify a `disk_image` path or a cloud-init compatible base image. On macOS, a fallback to `podman machine` or QEMU directly is acceptable, but Linux is the primary supported host OS for VM labs.
- **FR-20** `given` setup commands are executed inside the environment automatically after provisioning and before the terminal is handed to the learner.
- **FR-21** Each lab session gets its own isolated environment instance (one container/VM per active session).
- **FR-22** Environments are cleaned up (stopped and removed) when the session ends or times out.

### 4.6 Session Management

- **FR-23** A session is created when a learner opens a lab page and destroyed when they navigate away or close the tab.
- **FR-24** Sessions have a configurable inactivity timeout (default: 30 minutes) after which the environment is torn down.
- **FR-25** The backend assigns a unique session ID per lab visit, used to route terminal WebSocket traffic and validation requests to the correct environment.

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
  ├── GET /               → Lab list page
  ├── GET /labs/:id       → Lab page (instructions + terminal UI)
  ├── WebSocket /ws/:sessionId  → PTY stream (terminal I/O)
  └── POST /api/validate/:sessionId → Trigger solution check

Backend (Node.js / Python)
  │
  ├── Lab config loader   → Reads & watches ./labs/*.yaml
  ├── Session manager     → Creates/destroys sessions, manages timeouts
  ├── Provisioner         → Calls Podman CLI or libvirt to start/stop environment
  │     ├── podman run ...        (type: container)
  │     └── virsh / virt-install  (type: virtual-machine, Linux only)
  ├── PTY bridge          → Attaches WebSocket to container exec shell
  └── Validator           → Runs expected.check commands inside environment

./labs/
  ├── 01-create-file.yaml
  ├── 02-manage-permissions.yaml
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
description: |
  ## Objective
  Create a file named `hello.txt` inside the `/challenge` directory.

  ## Hints
  - Use the `touch` command to create an empty file.
  - The full path should be `/challenge/hello.txt`.
type: container
image: ubuntu:24.04
given:
  - command: "mkdir -p /challenge"
expected:
  - description: "/challenge/hello.txt must exist"
    check: "test -f /challenge/hello.txt"
```

### `labs/02-file-permissions.yaml`
```yaml
id: file-permissions
name: "Set File Permissions"
description: |
  ## Objective
  Make the file `/challenge/script.sh` executable by its owner.

  ## Hints
  - Use `chmod` to modify file permissions.
  - The owner execute bit can be set with `chmod u+x`.
type: container
image: ubuntu:24.04
given:
  - command: "mkdir -p /challenge && touch /challenge/script.sh"
expected:
  - description: "script.sh must be executable by owner"
    check: "test -x /challenge/script.sh"
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
- VM support beyond what Podman natively supports on the host OS
- Mobile browser support

---

## 11. Acceptance Criteria

| ID | Criteria |
|----|----------|
| AC-01 | Admin can start the platform with one command. |
| AC-02 | Home page displays all labs from the `labs/` directory. |
| AC-03 | Clicking a lab opens a page with a live terminal connected to a fresh isolated environment — a Podman container for `type: container` labs, or a libvirt-managed VM (via virt-manager) for `type: virtual-machine` labs. |
| AC-04 | The left panel shows the lab instructions rendered from the YAML `description` field (Markdown). |
| AC-05 | Clicking "Check Solution" runs all `expected.check` commands and displays pass/fail. |
| AC-06 | Adding a new `.yaml` file to `labs/` causes it to appear in the lab list without restarting the server. |
| AC-07 | Navigating away from a lab tears down the Podman container/VM. |
| AC-08 | Two concurrent learner sessions for the same lab run in completely separate containers. |
| AC-09 | All `given` setup commands run successfully before the learner's shell is ready. |
| AC-10 | The platform requires no host dependency other than Podman (container labs) and optionally virt-manager / libvirt (VM labs on Linux). |
