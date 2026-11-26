import {
  getBranchSha, getCommitTreeSha, createBranchRef, createBlob,
  createTree, createCommit, updateBranchRef, getFileContent, deleteBranch, listBranches
} from './github.js';

const BRANCH_PREFIX = 'debugbuilder/build-';
const STALE_AGE_MS = 15 * 60 * 1000;

export function branchName(buildId) { return `${BRANCH_PREFIX}${buildId}`; }

export async function createBuildBranch(buildId, { zipBuffer, config, state }) {
  const branch = branchName(buildId);
  const baseBranch = process.env.GITHUB_BRANCH || 'main';
  
  const baseSha = await getBranchSha(baseBranch);
  const baseTreeSha = await getCommitTreeSha(baseSha);

  await createBranchRef(branch, baseSha);

  const zipBlobSha = await createBlob(zipBuffer.toString('base64'));
  const configBlobSha = await createBlob(Buffer.from(JSON.stringify(config, null, 2)).toString('base64'));
  const stateBlobSha = await createBlob(Buffer.from(JSON.stringify(state, null, 2)).toString('base64'));

  const tree = await createTree(baseTreeSha, [
    { path: `builds/${buildId}/project.zip`, mode: '100644', type: 'blob', sha: zipBlobSha },
    { path: `builds/${buildId}/config.json`, mode: '100644', type: 'blob', sha: configBlobSha },
    { path: `builds/${buildId}/state.json`, mode: '100644', type: 'blob', sha: stateBlobSha }
  ]);

  const commit = await createCommit(`[build] ${buildId} — init`, tree, baseSha);
  await updateBranchRef(branch, commit, false);

  return { branch, commit };
}

export async function getBuildState(buildId) {
  const content = await getFileContent(`builds/${buildId}/state.json`, branchName(buildId));
  return content ? JSON.parse(content) : null;
}

export async function cleanupStaleBranches() {
  const branches = await listBranches(BRANCH_PREFIX);
  const cutoff = Date.now() - STALE_AGE_MS;
  let deleted = 0;
  for (const b of branches) {
    const buildId = b.name.slice(BRANCH_PREFIX.length);
    try {
      const state = await getBuildState(buildId);
      if (!state || state.updatedAt < cutoff) {
        await deleteBranch(b.name);
        deleted++;
      }
    } catch {}
  }
  return { scanned: branches.length, deleted };
}
