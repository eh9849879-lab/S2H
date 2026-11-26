import formidable from 'formidable';
import fs from 'fs';
import JSZip from 'jszip';
import crypto from 'crypto';
import { handlePreflight, json, error } from '../../lib/cors.js';
import { createBuildBranch } from '../../lib/storage.js';
import { triggerWorkflow } from '../../lib/github.js';

export const config = { api: { bodyParser: false, sizeLimit: '4.5mb' } };

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({ multiples: true, maxFileSize: 4.4 * 1024 * 1024, allowEmptyFiles: true, minFileSize: 0 });
    form.parse(req, (err, fields, files) => err ? reject(err) : resolve({ fields, files }));
  });
}

const asArr = v => Array.isArray(v) ? v : v ? [v] : [];
const asStr = v => Array.isArray(v) ? v[0] : (v ?? '');

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') return error(res, 405, 'Method not allowed');

  let parsed;
  try { parsed = await parseMultipart(req); } catch (e) { return error(res, 400, 'Multipart error: ' + e.message); }

  const { fields, files } = parsed;
  const rawFiles = asArr(files.files);
  const filePaths = asArr(fields.filePaths);

  if (!rawFiles.length) return error(res, 400, 'No files uploaded');

  const zip = new JSZip();
  for (let i = 0; i < rawFiles.length; i++) {
    const f = rawFiles[i];
    const path = String(filePaths[i] || f.originalFilename || `file-${i}`).replace(/^\/+/, '');
    zip.file(path, await fs.promises.readFile(f.filepath));
  }
  const zipBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  let configObj = {}, permissions = [], signing = null;
  try { configObj = JSON.parse(asStr(fields.config) || '{}'); } catch {}
  try { permissions = JSON.parse(asStr(fields.permissions) || '[]'); } catch {}
  try { signing = JSON.parse(asStr(fields.signing) || 'null'); } catch {}

  const buildId = crypto.randomUUID();
  const buildType = asStr(fields.buildType) === 'AAB' ? 'AAB' : 'APK';
  const variant = asStr(fields.variant) === 'release' ? 'release' : 'debug';

  if ((variant === 'release' || buildType === 'AAB') && !signing?.keystore) {
    return error(res, 400, 'Release signing key required.');
  }

  const config = {
    projectName: asStr(fields.projectName) || 'App',
    packageName: asStr(fields.packageName) || 'com.example.app',
    versionName: asStr(fields.versionName) || '1.0.0',
    versionCode: parseInt(asStr(fields.versionCode) || '1', 10) || 1,
    buildType, variant, config: configObj, permissions, signing, icon: asStr(fields.icon) || ''
  };

  const state = {
    buildId, status: 'queued', stage: 'Queued', progress: 0,
    logs: ['Build queued', `Project: ${config.projectName}`, `Files: ${rawFiles.length}`],
    createdAt: Date.now(), updatedAt: Date.now()
  };

  try {
    await createBuildBranch(buildId, { zipBuffer: zipBuf, config, state });
    await triggerWorkflow(buildId);
    json(res, 200, { buildId });
  } catch (e) {
    error(res, 500, 'Failed to start build: ' + e.message);
  }
                                     }
