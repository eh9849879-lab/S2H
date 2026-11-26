#!/usr/bin/env node
const fs = require('fs'); 
const path = require('path'); 
const { execSync } = require('child_process');

const BUILD_ID = process.env.BUILD_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;
const ARTIFACT_PATH = process.env.ARTIFACT_PATH;

async function ghApi(method, endpoint, body) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    method, 
    headers: { 
      'Authorization': `Bearer ${GITHUB_TOKEN}`, 
      'Accept': 'application/vnd.github+json', 
      'Content-Type': 'application/json' 
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  return res.json();
}

async function uploadAsset(uploadUrlBase, filePath, name) {
  const buf = fs.readFileSync(filePath);
  const url = uploadUrlBase.replace('{?name,label}', '') + `?name=${encodeURIComponent(name)}`;
  const res = await fetch(url, { 
    method: 'POST', 
    headers: { 
      'Authorization': `Bearer ${GITHUB_TOKEN}`, 
      'Content-Type': 'application/octet-stream' 
    }, 
    body: buf 
  });
  if (!res.ok) throw new Error(`Asset upload failed: ${res.status}`);
  return res.json();
}

async function main() {
  if (!ARTIFACT_PATH || !fs.existsSync(ARTIFACT_PATH)) {
    throw new Error(`Artifact file not found at: ${ARTIFACT_PATH}`);
  }

  const tag = `build-${BUILD_ID}`;
  const fileName = path.basename(ARTIFACT_PATH);

  console.log('Creating release', tag);
  const release = await ghApi('POST', `/repos/${GITHUB_REPOSITORY}/releases`, {
    tag_name: tag, 
    name: `Build ${BUILD_ID}`, 
    draft: false, 
    prerelease: false
  });

  console.log('Uploading artifact', fileName);
  const asset = await uploadAsset(release.upload_url, ARTIFACT_PATH, fileName);

  const statePath = `builds/${BUILD_ID}/state.json`;
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.status = 'success'; 
  state.stage = 'Completed'; 
  state.progress = 100;
  state.artifactUrl = asset.browser_download_url; 
  state.artifactName = fileName;
  state.artifactSize = fs.statSync(ARTIFACT_PATH).size; 
  state.finishedAt = Date.now();
  state.logs = [...(state.logs || []), '✔ Build complete'].slice(-300);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

  execSync('git config user.email "bot@debugbuilder.local"');
  execSync('git config user.name "Debug Builder Bot"');
  execSync(`git add "${statePath}"`);
  execSync(`git diff --cached --quiet || git commit -m "[build] ${BUILD_ID} — SUCCESS"`);
  execSync('git push origin HEAD');
}
main().catch(e => { console.error(e); process.exit(1); });
