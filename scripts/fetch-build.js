#!/usr/bin/env node
const fs = require('fs'); const path = require('path'); const JSZip = require('jszip');
const BUILD_ID = process.env.BUILD_ID;

async function main() {
  const zipPath = `builds/${BUILD_ID}/project.zip`;
  const cfgPath = `builds/${BUILD_ID}/config.json`;
  if (!fs.existsSync(zipPath)) throw new Error('project.zip not found');

  fs.mkdirSync('build-data', { recursive: true });
  fs.copyFileSync(cfgPath, 'build-data/config.json');

  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const outRoot = 'build-data/project'; fs.mkdirSync(outRoot, { recursive: true });

  for (const name of Object.keys(zip.files)) {
    const entry = zip.files[name]; const dest = path.join(outRoot, name);
    if (entry.dir) { fs.mkdirSync(dest, { recursive: true }); continue; }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, await entry.async('nodebuffer'));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
