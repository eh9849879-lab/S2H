#!/usr/bin/env node
const fs = require('fs'); const path = require('path'); const { execSync } = require('child_process');
const BUILD_ID = process.env.BUILD_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;

async function ghApi(method, endpoint, body) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    method, headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

async function uploadAsset(uploadUrlBase, filePath, name) {
  const buf = fs.readFileSync(filePath);
  const url = uploadUrlBase.replace('{?name,label}', '') + `?name=${encodeURIComponent(name)}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/octet-stream' }, body: buf });
  return res.json();
}

async function main() {
  const meta = JSON.parse(fs.readFileSync('build-workspace/build-meta.json', 'utf8'));
  const artifactPath = meta.outputPath;
  const tag = `build-${BUILD_ID}`;

  const release = await ghApi('POST', `/repos/${GITHUB_REPOSITORY}/releases`, {
    tag_name: tag, name: `Build ${BUILD_ID}`, draft: false, prerelease: false
  });
  const asset = await uploadAsset(release.upload_url, artifactPath, path.basename(artifactPath));

  const statePath = `builds/${BUILD_ID}/state.json`;
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.status = 'success'; state.stage = 'Completed'; state.progress = 100;
  state.artifactUrl = asset.browser_download_url; state.artifactName = path.basename(artifactPath);
  state.artifactSize = fs.statSync(artifactPath).size; state.finishedAt = Date.now();
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

  execSync('git config user.email "bot@debugbuilder.local"');
  execSync('git config user.name "Debug Builder Bot"');
  execSync(`git add "${statePath}"`);
  execSync(`git commit -m "[build] ${BUILD_ID} — SUCCESS"`);
  execSync('git push origin HEAD');
}
main().catch(e => { console.error(e); process.exit(1); });
