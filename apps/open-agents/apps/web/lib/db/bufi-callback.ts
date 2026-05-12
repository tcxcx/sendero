// DB helpers for the bufi-callback workflow. Wraps the raw db client so
// workflow files don't import "postgres" transitively (Vercel Workflow's
// `workflow-node-module-error` plugin flags any direct workflow-traceable
// path to a Node.js module).

import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { db } from './client';
import { sessions } from './schema';

export interface BufiCallbackSessionState {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'archived';
  bufiCallbackUrl: string | null;
  bufiCallbackSecret: string | null;
  bufiCallbackFiredAt: Date | null;
  repoOwner: string | null;
  repoName: string | null;
  branch: string | null;
  title: string;
}

export async function getBufiCallbackSessionState(
  sessionId: string
): Promise<BufiCallbackSessionState | undefined> {
  const rows = await db
    .select({
      id: sessions.id,
      status: sessions.status,
      bufiCallbackUrl: sessions.bufiCallbackUrl,
      bufiCallbackSecret: sessions.bufiCallbackSecret,
      bufiCallbackFiredAt: sessions.bufiCallbackFiredAt,
      repoOwner: sessions.repoOwner,
      repoName: sessions.repoName,
      branch: sessions.branch,
      title: sessions.title,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  return rows[0] as BufiCallbackSessionState | undefined;
}

/**
 * Atomically mark a session's callback as fired. Returns true if this
 * call won the race (= caller should fire), false if another path already
 * fired the callback or no callback was configured.
 */
export async function markBufiCallbackFired(sessionId: string): Promise<boolean> {
  const result = await db
    .update(sessions)
    .set({ bufiCallbackFiredAt: new Date() })
    .where(
      and(
        eq(sessions.id, sessionId),
        isNotNull(sessions.bufiCallbackUrl),
        isNull(sessions.bufiCallbackFiredAt)
      )
    )
    .returning({ id: sessions.id });
  return result.length > 0;
}
