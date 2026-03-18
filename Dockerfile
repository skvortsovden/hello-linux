# syntax=docker/dockerfile:1

# ---- stage 1: build ----
# Full image has Python / make / g++ needed to compile node-pty's native addon.
FROM node:20 AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ---- stage 2: runtime ----
# Grab just the docker CLI binary from the official image.
FROM docker:cli AS docker-cli

FROM node:20-slim
WORKDIR /app

COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=builder    /app/node_modules      ./node_modules

# virtinst (virt-install) + libvirt-clients (virsh) for VM labs
RUN apt-get update \
  && apt-get install -y --no-install-recommends virtinst libvirt-clients \
  && rm -rf /var/lib/apt/lists/*

COPY src/     ./src/
COPY public/  ./public/
COPY labs/    ./labs/

EXPOSE 3000

CMD ["node", "src/server.js"]
