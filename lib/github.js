const API = 'https://api.github.com';

function headers() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN missing');
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'DebugBuilder-Backend',
    'Content-Type': 'application/json'
  };
}

export function repoInfo() {
  const repo = process.env.GITHUB_REPO;
  if (!repo || !repo.includes('/')) throw new Error('GITHUB_REPO invalid');
  const [owner, name] = repo.split('/');
  return { owner, name, full: repo };
}

async function gh(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    method: opts.method || 'GET',
    headers: headers(),
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub API Error ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function getBranchSha(branch) {
  const { owner, name } = repoInfo();
  try {
    const ref = await gh(`/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(branch)}`);
    return ref.object.sha;
  } catch (e) {
    const repo = await gh(`/repos/${owner}/${name}`);
    const ref = await gh(`/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(repo.default_branch)}`);
    return ref.object.sha;
  }
}

export async function getCommitTreeSha(commitSha) {
  const { owner, name } = repoInfo();
  const commit = await gh(`/repos/${owner}/${name}/git/commits/${commitSha}`);
  return commit.tree.sha;
}

export async function createBranchRef(branchName, fromSha) {
  const { owner, name } = repoInfo();
  return gh(`/repos/${owner}/${name}/git/refs`, {
    method: 'POST', body: { ref: `refs/heads/${branchName}`, sha: fromSha }
  });
}

export async function createBlob(contentBase64) {
  const { owner, name } = repoInfo();
  const res = await gh(`/repos/${owner}/${name}/git/blobs`, {
    method: 'POST', body: { content: contentBase64, encoding: 'base64' }
  });
  return res.sha;
}

export async function createTree(baseTreeSha, treeEntries) {
  const { owner, name } = repoInfo();
  const res = await gh(`/repos/${owner}/${name}/git/trees`, {
    method: 'POST', body: { base_tree: baseTreeSha, tree: treeEntries }
  });
  return res.sha;
}

export async function createCommit(message, treeSha, parentSha) {
  const { owner, name } = repoInfo();
  const res = await gh(`/repos/${owner}/${name}/git/commits`, {
    method: 'POST', body: { message, tree: treeSha, parents: [parentSha] }
  });
  return res.sha;
}

export async function updateBranchRef(branchName, newSha, force = false) {
  const { owner, name } = repoInfo();
  return gh(`/repos/${owner}/${name}/git/refs/heads/${encodeURIComponent(branchName)}`, {
    method: 'PATCH', body: { sha: newSha, force }
  });
}

export async function getFileContent(path, branch) {
  const { owner, name } = repoInfo();
  try {
    const res = await fetch(`${API}/repos/${owner}/${name}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`, { headers: headers() });
    if (!res.ok) return null;
    const data = await res.json();
    return data.content ? Buffer.from(data.content, 'base64').toString('utf8') : null;
  } catch { return null; }
}

export async function putFileContent(path, branch, content, message) {
  const { owner, name } = repoInfo();
  let sha = null;
  try {
    const res = await fetch(`${API}/repos/${owner}/${name}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`, { headers: headers() });
    if (res.ok) { const data = await res.json(); sha = data.sha; }
  } catch {}
  return gh(`/repos/${owner}/${name}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    body: { message, content: Buffer.from(content).toString('base64'), branch, ...(sha ? { sha } : {}) }
  });
}

export async function triggerWorkflow(buildId) {
  const { owner, name } = repoInfo();
  const workflow = process.env.GITHUB_WORKFLOW_FILE || 'android-build.yml';
  const branch = process.env.GITHUB_BRANCH || 'main';
  const res = await fetch(`${API}/repos/${owner}/${name}/actions/workflows/${workflow}/dispatches`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ ref: branch, inputs: { buildId } })
  });
  if (!res.ok) throw new Error(`Workflow trigger failed: ${res.status}`);
  return true;
}

export async function deleteBranch(branchName) {
  const { owner, name } = repoInfo();
  try {
    await gh(`/repos/${owner}/${name}/git/refs/heads/${encodeURIComponent(branchName)}`, { method: 'DELETE' });
    return true;
  } catch { return false; }
}

export async function listBranches(prefix) {
  const { owner, name } = repoInfo();
  try {
    const res = await gh(`/repos/${owner}/${name}/branches?per_page=100`);
    return (res || []).filter(b => b.name.startsWith(prefix));
  } catch { return []; }
}
