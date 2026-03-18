# syntax=docker/dockerfile:1

# Grab just the docker CLI binary — no need to install the full package
FROM docker:cli AS docker-cli

FROM node:20-slim
# node-pty uses prebuilt binaries for linux/amd64 and linux/arm64 — no
# compilation needed.
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install --omit=dev

# Copy application source
COPY src/     ./src/
COPY public/  ./public/
COPY labs/    ./labs/

EXPOSE 3000

CMD ["node", "src/server.js"]
