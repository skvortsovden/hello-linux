'use strict';

const fs       = require('fs');
const path     = require('path');
const yaml     = require('js-yaml');
const chokidar = require('chokidar');

const LABS_DIR = path.resolve(__dirname, '..', 'labs');

/** Map of labId → lab object (includes internal _filePath). */
const labs = new Map();

function loadFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lab = yaml.load(raw);
    if (!lab || typeof lab !== 'object' || !lab.id) {
      console.warn(`[labLoader] Skipping ${filePath}: missing required "id" field`);
      return;
    }
    lab._filePath = filePath;
    labs.set(lab.id, lab);
    console.log(`[labLoader] Loaded lab "${lab.id}" from ${path.basename(filePath)}`);
  } catch (err) {
    console.error(`[labLoader] Error loading ${filePath}: ${err.message}`);
  }
}

function removeFile(filePath) {
  for (const [id, lab] of labs.entries()) {
    if (lab._filePath === filePath) {
      labs.delete(id);
      console.log(`[labLoader] Removed lab "${id}"`);
    }
  }
}

function init() {
  if (!fs.existsSync(LABS_DIR)) {
    fs.mkdirSync(LABS_DIR, { recursive: true });
    console.log(`[labLoader] Created labs directory at ${LABS_DIR}`);
  }

  const files = fs.readdirSync(LABS_DIR).filter(f => /\.ya?ml$/.test(f));
  files.forEach(f => loadFile(path.join(LABS_DIR, f)));

  chokidar
    .watch(LABS_DIR, {
      persistent:      true,
      ignoreInitial:   true,
      awaitWriteFinish: { stabilityThreshold: 300 },
    })
    .on('add',    fp => { if (/\.ya?ml$/.test(fp)) loadFile(fp); })
    .on('change', fp => { if (/\.ya?ml$/.test(fp)) loadFile(fp); })
    .on('unlink', fp => removeFile(fp));

  console.log(`[labLoader] Initialized with ${labs.size} lab(s). Watching ${LABS_DIR}`);
}

module.exports = { labs, init };
