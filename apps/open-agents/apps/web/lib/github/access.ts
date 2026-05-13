import { getInstallationByAccountLogin } from '@/lib/db/installations';
import { withScopedInstallationOctokit } from './app';
import { getUserOctokit } from './client';

/**
 * SENDERO bridge bot user — server-to-server dispatched sessions own no
 * OAuth token. We bypass the user-octokit precondition for this user
 * and trust the App installation scope alone.
 *
 * See: docs/superpowers/specs/2026-05-11-phase-1-minion-bridge.md
 */
const SENDERO_BOT_USER_ID = 'sendero-bridge-bot';

export type RepoAccessDeniedReason =
  | 'no_user_token'
  | 'user_no_access'
  | 'user_no_write'
  | 'no_installation'
  | 'app_no_access';

export type RequiredRepoUserPermission = 'read' | 'write';

export type RepoAccessResult =
  | {
      ok: true;
      installationId: number;
      repositoryId: number;
      defaultBranch: string;
    }
  | { ok: false; reason: RepoAccessDeniedReason };

function hasUserWritePermission(
  permissions:
    | {
        admin: boolean;
        maintain?: boolean;
        push: boolean;
      }
    | undefined
): boolean {
  return Boolean(permissions?.admin || permissions?.maintain || permissions?.push);
}

function getGitHubHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  if ('status' in error && typeof error.status === 'number') {
    return error.status;
  }

  if (
    'response' in error &&
    error.response &&
    typeof error.response === 'object' &&
    'status' in error.response &&
    typeof error.response.status === 'number'
  ) {
    return error.response.status;
  }

  return null;
}

/**
 * Verify that the user can access a repo AND the GitHub App installation
 * covers it. Returns the installationId on success.
 *
 * This enforces the intersection: user permissions ∩ installation scope.
 */
export async function verifyRepoAccess(params: {
  userId: string;
  owner: string;
  repo: string;
  requiredUserPermission?: RequiredRepoUserPermission;
}): Promise<RepoAccessResult> {
  const { userId, owner, repo, requiredUserPermission = 'read' } = params;

  // SENDERO bridge bot: no OAuth token by design — fall through to App-only
  // verification using the persisted github_installations row.
  if (userId === SENDERO_BOT_USER_ID) {
    return verifyRepoAccessAppOnly({ userId, owner, repo });
  }

  // 1. check user can see the repo
  const userOctokit = await getUserOctokit(userId);
  if (!userOctokit) {
    return { ok: false, reason: 'no_user_token' };
  }

  let repositoryId: number;
  let defaultBranch: string;
  try {
    const userRepoResponse = await userOctokit.rest.repos.get({ owner, repo });
    repositoryId = userRepoResponse.data.id;
    defaultBranch = userRepoResponse.data.default_branch;
    if (
      requiredUserPermission === 'write' &&
      !hasUserWritePermission(userRepoResponse.data.permissions)
    ) {
      return { ok: false, reason: 'user_no_write' };
    }
  } catch (error: unknown) {
    const status = getGitHubHttpStatus(error);
    if (status === 404 || status === 403) {
      return { ok: false, reason: 'user_no_access' };
    }
    throw error;
  }

  // 2. check installation exists for this owner
  const installation = await getInstallationByAccountLogin(userId, owner);
  if (!installation) {
    return { ok: false, reason: 'no_installation' };
  }

  // 3. check installation covers this specific repo
  try {
    await withScopedInstallationOctokit({
      installationId: installation.installationId,
      repositoryId,
      permissions: { contents: 'read' },
      operation: async installationOctokit => {
        await installationOctokit.rest.repos.get({ owner, repo });
      },
    });
  } catch (error: unknown) {
    const status = getGitHubHttpStatus(error);
    const message = error instanceof Error ? error.message : '';
    if (status === 404 || status === 403 || status === 422 || message.includes(': 422 ')) {
      return { ok: false, reason: 'app_no_access' };
    }
    throw error;
  }

  return {
    ok: true,
    installationId: installation.installationId,
    repositoryId,
    defaultBranch,
  };
}

/**
 * App-only repo access check — used for the SENDERO bridge bot which has no
 * OAuth token. Uses the App installation directly to fetch the repo id +
 * default branch.
 *
 * Auth: an App-installation-authenticated Octokit. Scope = the entire
 * installation, not a specific repo, so we can call `repos.get` to look
 * up the repo id we'd otherwise need to pre-fetch.
 */
async function verifyRepoAccessAppOnly(params: {
  userId: string;
  owner: string;
  repo: string;
}): Promise<RepoAccessResult> {
  const installation = await getInstallationByAccountLogin(params.userId, params.owner);
  if (!installation) {
    return { ok: false, reason: 'no_installation' };
  }

  const { getInstallationOctokit } = await import('./app');
  const installationOctokit = await getInstallationOctokit(installation.installationId);

  try {
    const response = await installationOctokit.rest.repos.get({
      owner: params.owner,
      repo: params.repo,
    });
    return {
      ok: true,
      installationId: installation.installationId,
      repositoryId: response.data.id,
      defaultBranch: response.data.default_branch,
    };
  } catch (error: unknown) {
    const status = getGitHubHttpStatus(error);
    if (status === 404 || status === 403) {
      return { ok: false, reason: 'app_no_access' };
    }
    throw error;
  }
}

/**
 * Map access denial reasons to user-facing error messages.
 */
export function getRepoAccessErrorMessage(reason: RepoAccessDeniedReason): string {
  switch (reason) {
    case 'no_user_token':
      return 'Connect GitHub to access repositories';
    case 'user_no_access':
      return "You don't have access to this repository";
    case 'user_no_write':
      return 'You need write access to this repository to perform this action';
    case 'no_installation':
      return 'GitHub App not installed for this organization. Install it from Settings > Connections.';
    case 'app_no_access':
      return "GitHub App doesn't have access to this repository. Ask an org admin to update the app's repository permissions.";
  }
}
