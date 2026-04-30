import { getOptionalBooleanEnv, getOptionalEnv } from './env.js';

const DEFAULT_BRANCH = 'main';
const DEFAULT_NETWORK_MODE = 'allow_list';
const BRANCH_PATTERN = /^\S+$/;
const HTTPS_REPO_PATTERN = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i;
const SSH_REPO_PATTERN = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i;

export function parseGithubRepositoryUrl(value) {
  const normalized = value.trim();
  if (!normalized) return null;

  const sshMatch = normalized.match(SSH_REPO_PATTERN);
  if (sshMatch) return buildParsedGithubRepository(sshMatch[1], sshMatch[2]);

  const httpsMatch = normalized.match(HTTPS_REPO_PATTERN);
  if (!httpsMatch) return null;
  return buildParsedGithubRepository(httpsMatch[1], httpsMatch[2]);
}

function buildParsedGithubRepository(owner, repoName) {
  const normalizedOwner = owner?.trim().toLowerCase();
  const normalizedRepoName = repoName?.trim().toLowerCase();
  if (!normalizedOwner || !normalizedRepoName) return null;
  return {
    normalizedRepoUrl: `https://github.com/${normalizedOwner}/${normalizedRepoName}`,
    owner: normalizedOwner,
    repoName: normalizedRepoName,
  };
}

export function buildRepositoryWorkspaceSlug(owner, repoName, branch) {
  const baseSlug = `${owner}-${repoName}`.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
  if (branch === DEFAULT_BRANCH) return baseSlug;
  return `${baseSlug}@${sanitizeRepositoryWorkspaceBranch(branch)}`;
}

function sanitizeRepositoryWorkspaceBranch(branchName) {
  const sanitized = branchName
    .replace(/\//g, '--')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-{3,}/g, '--')
    .replace(/^[-.]+|[-.]+$/g, '');
  return sanitized || 'branch';
}

export function normalizeSandboxAllowedOutboundHosts(value) {
  if (!value) return [];
  return value
    .split(/[\n,]/g)
    .map(host => host.trim().toLowerCase())
    .filter(Boolean)
    .filter((host, index, list) => list.indexOf(host) === index);
}

function resolveSandboxNetworkMode(value) {
  if (!value) return DEFAULT_NETWORK_MODE;
  if (value === 'allow_all' || value === 'allow_list') return value;
  throw new Error('AGENT_SANDBOX_NETWORK_MODE must be "allow_all" or "allow_list".');
}

function buildSandboxPromptSuffix(workspaceSlug) {
  return [
    '',
    '',
    `If a sandbox GitHub repository is mounted for this node, inspect /workspace/repos/${workspaceSlug} before answering repository-specific or code-specific questions.`,
    'Read the README and the most relevant files before making claims.',
    'Prefer repo inspection before escalating to Slack when the answer likely exists in the repository.',
    'Do not edit outside the mounted repository.',
  ].join('\n');
}

export function resolveAgentSandboxTemplatePatchFromEnv() {
  const sandboxEnabled = getOptionalBooleanEnv('AGENT_SANDBOX_ENABLED');
  const repoUrl = (
    process.env.AGENT_SANDBOX_GITHUB_REPO_URL ??
    process.env.AGENT_SANDBOX_REPO_URL ??
    ''
  ).trim();
  const branch =
    (
      process.env.AGENT_SANDBOX_GITHUB_REPO_BRANCH ??
      process.env.AGENT_SANDBOX_REPO_BRANCH ??
      ''
    ).trim() || DEFAULT_BRANCH;
  const pat = (process.env.AGENT_SANDBOX_GITHUB_PAT ?? process.env.AGENT_SANDBOX_PAT ?? '').trim();

  if (!repoUrl) {
    if (pat) throw new Error('AGENT_SANDBOX_GITHUB_PAT requires AGENT_SANDBOX_GITHUB_REPO_URL.');
    if (sandboxEnabled === true) {
      throw new Error('AGENT_SANDBOX_ENABLED=true requires AGENT_SANDBOX_GITHUB_REPO_URL.');
    }
    if (sandboxEnabled === false) return { configPatch: { sandbox_enabled: false } };
    return null;
  }

  if (!BRANCH_PATTERN.test(branch)) {
    throw new Error(
      'AGENT_SANDBOX_GITHUB_REPO_BRANCH must be a non-empty branch name without spaces.'
    );
  }

  const repository = parseGithubRepositoryUrl(repoUrl);
  if (!repository)
    throw new Error('AGENT_SANDBOX_GITHUB_REPO_URL must be a GitHub repository root URL.');

  const workspaceSlug = buildRepositoryWorkspaceSlug(repository.owner, repository.repoName, branch);
  const resource = {
    branch,
    repo_url: repository.normalizedRepoUrl,
    resource_type: 'github_repository',
  };
  if (pat) resource.pat = pat;

  const enabled = sandboxEnabled ?? true;
  return {
    configPatch: {
      flow_agent_resources: [resource],
      sandbox_allowed_outbound_hosts: normalizeSandboxAllowedOutboundHosts(
        process.env.AGENT_SANDBOX_ALLOWED_OUTBOUND_HOSTS
      ),
      sandbox_enabled: enabled,
      sandbox_network_mode: resolveSandboxNetworkMode(getOptionalEnv('AGENT_SANDBOX_NETWORK_MODE')),
    },
    promptSuffix: enabled ? buildSandboxPromptSuffix(workspaceSlug) : undefined,
    workspaceSlug,
  };
}
