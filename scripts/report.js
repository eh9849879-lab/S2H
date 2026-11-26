#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BUILD_ID = process.env.BUILD_ID;
const STATE_PATH = `builds/${BUILD_ID}/state.json`;

function readState() { return fs.existsSync(STATE_PATH) ? JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) : { logs: [] }; }
function writeState(state) { state.updatedAt = Date.now(); fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2)); }
function gitCommitPush(msg) {
  execSync('git config user.email "bot@debugbuilder.local"');
  execSync('git config user.name "Debug Builder Bot"');
  execSync(`git add "${STATE_PATH}"`);
  execSync(`git diff --cached --quiet || git commit -m "${msg.replace(/"/g, '\\"')}"`);
  execSync('git push origin HEAD');
}

function updateProgress(stage, progress, log) {
  const state = readState();
  state.status = 'running'; state.stage = stage; state.progress = progress;
  state.startedAt = state.startedAt || Date.now();
  if (log) state.logs = [...(state.logs || []), log].slice(-300);
  writeState(state); gitCommitPush(`[build] ${BUILD_ID} — ${stage} (${progress}%)`);
}

function reportFailure(stage, errorMsg) {
  const state = readState();
  state.status = 'failed'; state.stage = stage; state.error = errorMsg; state.finishedAt = Date.now();
  state.logs = [...(state.logs || []), `✖ ${errorMsg}`].slice(-300);
  writeState(state); gitCommitPush(`[build] ${BUILD_ID} — FAILED`);
}

(async () => {
  const args = process.argv.slice(2);
  if (args[0] === '--fail') reportFailure(args[1] || 'Failed', args.slice(2).join(' ') || 'Build failed');
  else updateProgress(args[0] || 'Working', parseInt(args[1] || '10', 10), args.slice(2).join(' '));
})();
