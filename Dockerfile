# syntax=docker/dockerfile:1
FROM node:20-slim

# ---------------------------------------------------------------------------
# System deps
#   - ca-certificates / curl  → fetch Docker GPG key
#   - docker-ce-cli           → container management (talks to host socket)
# node-pty uses prebuilt binaries for linux/amd64 and linux/arm64 — no
# compilation (python3/make/g++) needed.
# ---------------------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg \
  && install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://download.docker.com/linux/debian/gpg \
       | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
  && chmod a+r /etc/apt/keyrings/docker.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
       https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
       > /etc/apt/sources.list.d/docker.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends docker-ce-cli \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies (native compile happens here)
COPY package.json ./
RUN npm install --omit=dev

# Copy application source
COPY src/     ./src/
COPY public/  ./public/
COPY labs/    ./labs/

EXPOSE 3000

CMD ["node", "src/server.js"]
