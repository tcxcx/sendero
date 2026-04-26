#!/usr/bin/env bun
/**
 * defect-escape-report.ts
 *
 * Computes the defect-escape ratio over a configurable window. Joins
 *   `git log` × `gh issue list --label regression`
 * via the `Caused-By: <sha>` trailer that the regression issue template
 * stamps into the body. Writes a markdown report to
 *   ~/.gstack/projects/<slug>/defect-escape-<YYYY-MM-DD>.md
 * and prints it to stdout.
 *
 * Convention: GitHub issue label `regression` + body trailer
 *   Caused-By: <commit-sha>     (full or 7+ char prefix)
 *
 * Usage:
 *   bun run scripts/defect-escape-report.ts                  # 30-day window
 *   bun run scripts/defect-escape-report.ts --since="14 days ago"
 *   bun run scripts/defect-escape-report.ts --since="365 days ago"
 *
 * Zero infrastructure beyond the GitHub CLI (`gh`).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// --------------------------------------------------------------------------- args

const argv = process.argv.slice(2);
function readFlag(name: string, fallback: string): string {
  const prefix = `${name}=`;
  const hit = argv.find(a => a.startsWith(prefix));
  if (hit) return hit.slice(prefix.length);
  const idx = argv.indexOf(name);
  if (idx !== -1 && argv[idx + 1] && !argv[idx + 1].startsWith('--')) {
    return argv[idx + 1];
  }
  return fallback;
}

const since = readFlag('--since', '30 days ago');
const trendWeeks = Number(readFlag('--trend-weeks', '4'));
const offendersDays = Number(readFlag('--offenders-days', '90'));
const issueLabel = readFlag('--label', 'regression');
const issueLimit = Number(readFlag('--issue-limit', '100'));
const writeFile = !argv.includes('--no-write');

// --------------------------------------------------------------------------- helpers

function sh(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message?: string };
    const stderr = typeof e.stderr === 'string' ? e.stderr : (e.stderr?.toString() ?? '');
    throw new Error(`${cmd} ${args.join(' ')}\n${stderr || e.message || 'unknown error'}`);
  }
}

function maybeSh(cmd: string, args: string[]): string | null {
  try {
    return sh(cmd, args);
  } catch {
    return null;
  }
}

function projectSlug(): string {
  const remote = maybeSh('git', ['remote', 'get-url', 'origin']);
  if (remote) {
    // strip .git, take "owner/repo", swap / for -
    const cleaned = remote
      .replace(/\.git$/, '')
      .replace(/[:]/g, '/')
      .replace(/^https?:\/\/[^/]+\//, '')
      .replace(/^git@[^:]+:/, '');
    const parts = cleaned.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const slug = `${parts[parts.length - 2]}-${parts[parts.length - 1]}`;
      return slug.replace(/[^a-zA-Z0-9._-]/g, '');
    }
  }
  return 'repo';
}

function fmtPct(num: number, denom: number): string {
  if (denom === 0) return '—';
  return `${((num / denom) * 100).toFixed(1)}%`;
}

function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function isoYearWeek(d: Date): string {
  // ISO 8601 week-numbering year + week. Handy for trend buckets.
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7; // Mon=0
  target.setUTCDate(target.getUTCDate() - dayNum + 3); // nearest Thu
  const firstThu = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstThuDay = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - firstThuDay + 3);
  const week = 1 + Math.round((target.getTime() - firstThu.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// --------------------------------------------------------------------------- git

interface Commit {
  sha: string;
  shortSha: string;
  date: Date;
  author: string;
  subject: string;
}

function readCommits(sinceArg: string): Commit[] {
  const sep = ''; // ASCII unit separator — safe inside commit messages
  const recordSep = '';
  const fmt = `%H${sep}%h${sep}%aI${sep}%an${sep}%s${recordSep}`;
  const raw = maybeSh('git', ['log', `--since=${sinceArg}`, `--format=${fmt}`]) ?? '';
  if (!raw) return [];
  return raw
    .split(recordSep)
    .map(s => s.replace(/^\n+/, ''))
    .filter(Boolean)
    .map(line => {
      const [sha, shortSha, dateIso, author, subject] = line.split(sep);
      return {
        sha,
        shortSha,
        date: new Date(dateIso),
        author: author ?? 'unknown',
        subject: subject ?? '',
      };
    })
    .filter(c => c.sha);
}

// --------------------------------------------------------------------------- gh

interface GhIssue {
  number: number;
  title: string;
  body: string;
  url: string;
  createdAt: string;
  closedAt: string | null;
  author?: { login?: string };
}

function readRegressionIssues(label: string, limit: number): GhIssue[] {
  // gh fails closed if not authenticated; we want the script to still produce a useful
  // report from git history even when gh is unavailable.
  const raw = maybeSh('gh', [
    'issue',
    'list',
    '--label',
    label,
    '--state',
    'all',
    '--json',
    'number,title,body,url,createdAt,closedAt,author',
    '--limit',
    String(limit),
  ]);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as GhIssue[];
  } catch {
    return [];
  }
}

// --------------------------------------------------------------------------- join

interface DefectLink {
  issue: GhIssue;
  causedBy: string; // sha as written in the issue (full or short)
  matched?: Commit;
}

function extractCausedBy(body: string): string[] {
  const re = /Caused-By:\s*([0-9a-f]{7,40})/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  m = re.exec(body);
  while (m !== null) {
    out.push(m[1].toLowerCase());
    m = re.exec(body);
  }
  return out;
}

function matchSha(causedBy: string, commits: Commit[]): Commit | undefined {
  const needle = causedBy.toLowerCase();
  // exact full-sha match
  const exact = commits.find(c => c.sha === needle);
  if (exact) return exact;
  // prefix match (7+ chars). Be careful of collisions but at this scale it's fine.
  return commits.find(c => c.sha.startsWith(needle));
}

// --------------------------------------------------------------------------- main

function main(): void {
  // Quick sanity checks
  const inGitRepo = maybeSh('git', ['rev-parse', '--is-inside-work-tree']);
  if (inGitRepo !== 'true') {
    console.error('defect-escape-report: not inside a git repository');
    process.exit(1);
  }

  const now = new Date();
  const slug = projectSlug();
  const ghAuth = maybeSh('gh', ['auth', 'status']);

  // --- window commits
  const windowCommits = readCommits(since);
  const oldestSha =
    windowCommits.length > 0 ? windowCommits[windowCommits.length - 1].shortSha : '—';
  const newestSha = windowCommits.length > 0 ? windowCommits[0].shortSha : '—';

  // --- offenders window (always 90d default; broader than report window)
  const offenderCommits = readCommits(`${offendersDays} days ago`);

  // --- broader history (covers offenders + window) for matching across all defects
  const allHistoryCommits = readCommits(`${Math.max(offendersDays, 365)} days ago`);

  // --- defects (gh)
  const issues = readRegressionIssues(issueLabel, issueLimit);
  const links: DefectLink[] = [];
  for (const issue of issues) {
    const shas = extractCausedBy(issue.body ?? '');
    if (shas.length === 0) {
      // label without trailer — surface it so the team can fix the trailer
      links.push({ issue, causedBy: '', matched: undefined });
      continue;
    }
    for (const sha of shas) {
      const matched = matchSha(sha, allHistoryCommits);
      links.push({ issue, causedBy: sha, matched });
    }
  }

  const windowShas = new Set(windowCommits.map(c => c.sha));
  const offenderShas = new Set(offenderCommits.map(c => c.sha));

  const defectsInWindow = links.filter(l => l.matched && windowShas.has(l.matched.sha));
  const defectShasInWindow = new Set(defectsInWindow.map(l => l.matched!.sha));

  // --- trend (rolling weeks ending in the report window)
  const weekBuckets = new Map<string, { commits: number; defects: number }>();
  for (const c of windowCommits) {
    const key = isoYearWeek(c.date);
    const bucket = weekBuckets.get(key) ?? { commits: 0, defects: 0 };
    bucket.commits += 1;
    if (defectShasInWindow.has(c.sha)) bucket.defects += 1;
    weekBuckets.set(key, bucket);
  }
  const trendRows = [...weekBuckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(-Math.max(1, trendWeeks));

  // --- top offenders (last 90d)
  const offendersByAuthor = new Map<string, { commits: number; defects: number }>();
  for (const c of offenderCommits) {
    const row = offendersByAuthor.get(c.author) ?? { commits: 0, defects: 0 };
    row.commits += 1;
    offendersByAuthor.set(c.author, row);
  }
  for (const link of links) {
    if (!link.matched) continue;
    if (!offenderShas.has(link.matched.sha)) continue;
    const row = offendersByAuthor.get(link.matched.author) ?? { commits: 0, defects: 0 };
    row.defects += 1;
    offendersByAuthor.set(link.matched.author, row);
  }
  const offendersRows = [...offendersByAuthor.entries()]
    .map(([author, row]) => ({ author, ...row }))
    .sort((a, b) => b.defects - a.defects || b.commits - a.commits)
    .slice(0, 10);

  // ----------------------------------------------------------------- markdown
  const lines: string[] = [];
  lines.push('# Defect-escape report');
  lines.push('');
  lines.push(`Generated: ${now.toISOString()}`);
  lines.push(`Window: last ${since} (commits between \`${oldestSha}\` and \`${newestSha}\`)`);
  lines.push('');

  if (!ghAuth) {
    lines.push('> **Note:** `gh` CLI is not authenticated, so regression issues could not be');
    lines.push('> fetched. Defect counts below reflect git history only and will read as 0.');
    lines.push('> Run `gh auth login` and re-run to populate.');
    lines.push('');
  }

  // headline
  const ratioPct = fmtPct(defectsInWindow.length, windowCommits.length);
  lines.push('## Headline');
  lines.push(`- Commits in window: ${windowCommits.length}`);
  lines.push(`- Defect-escape commits: ${defectShasInWindow.size}`);
  lines.push(`- **Defect-escape ratio: ${ratioPct}**`);
  lines.push('');

  // trend
  lines.push('## Trend (rolling)');
  if (trendRows.length === 0) {
    lines.push('_no commits in window — nothing to plot._');
  } else {
    lines.push('| Week | Commits | Defects | Ratio |');
    lines.push('| --- | --- | --- | --- |');
    for (const [week, row] of trendRows) {
      lines.push(
        `| ${week} | ${row.commits} | ${row.defects} | ${fmtPct(row.defects, row.commits)} |`
      );
    }
  }
  lines.push('');

  // defects this window
  lines.push('## Defects this window');
  if (issues.length === 0) {
    if (ghAuth) {
      lines.push(
        `_No regressions in window — clean slate, or the \`${issueLabel}\` label / Caused-By trailer convention has not been adopted yet._`
      );
      lines.push('');
      lines.push('Adopt it by filing the next production issue with:');
      lines.push('```');
      lines.push(`gh issue create --label ${issueLabel} --template regression.yml`);
      lines.push('```');
    } else {
      lines.push('_`gh` not authenticated — see note above._');
    }
  } else if (defectsInWindow.length === 0) {
    lines.push(
      `_${issues.length} regression issue(s) on file, but none traced to commits in this window._`
    );
    const orphans = links.filter(l => !l.causedBy);
    if (orphans.length > 0) {
      lines.push('');
      lines.push(
        `Heads up: ${orphans.length} regression issue(s) carry the label but have no \`Caused-By:\` trailer in the body — they are excluded from the ratio:`
      );
      for (const l of orphans.slice(0, 5)) {
        lines.push(`- [#${l.issue.number}](${l.issue.url}) ${l.issue.title}`);
      }
    }
  } else {
    for (const link of defectsInWindow) {
      const created = link.issue.createdAt.slice(0, 10);
      const closed = link.issue.closedAt ? link.issue.closedAt.slice(0, 10) : 'open';
      const resolution = link.issue.closedAt
        ? fmtDuration(
            new Date(link.issue.closedAt).getTime() - new Date(link.issue.createdAt).getTime()
          )
        : 'open';
      const subject = link.matched?.subject ?? '(unmatched)';
      const sha = link.matched?.shortSha ?? link.causedBy.slice(0, 7);
      lines.push(
        `- [#${link.issue.number}](${link.issue.url}) \`${subject}\` — caused by \`${sha}\`, opened ${created}, closed ${closed} (resolution: ${resolution})`
      );
    }
  }
  lines.push('');

  // top offenders
  lines.push(`## Top offenders (last ${offendersDays}d)`);
  if (offendersRows.length === 0) {
    lines.push('_no commits in offender window._');
  } else if (offendersRows.every(r => r.defects === 0)) {
    lines.push('| Author | Commits | Defects | Ratio |');
    lines.push('| --- | --- | --- | --- |');
    for (const row of offendersRows) {
      lines.push(
        `| ${row.author} | ${row.commits} | ${row.defects} | ${fmtPct(row.defects, row.commits)} |`
      );
    }
    lines.push('');
    lines.push(
      '_All authors at 0 defects — either we ship clean, or the convention has not been adopted yet._'
    );
  } else {
    lines.push('| Author | Commits | Defects | Ratio |');
    lines.push('| --- | --- | --- | --- |');
    for (const row of offendersRows) {
      lines.push(
        `| ${row.author} | ${row.commits} | ${row.defects} | ${fmtPct(row.defects, row.commits)} |`
      );
    }
  }
  lines.push('');

  // convention reminder
  lines.push('## Convention');
  lines.push('');
  lines.push('File a production-traceable bug with `gh issue create --template regression.yml`.');
  lines.push('The template auto-applies the `regression` label and inserts the');
  lines.push('`Caused-By: <sha>` trailer the report joins on. See `CONTRIBUTING.md` for details.');

  const report = `${lines.join('\n')}\n`;

  // ----------------------------------------------------------------- write
  process.stdout.write(report);

  if (writeFile) {
    const outDir = join(homedir(), '.gstack', 'projects', slug);
    mkdirSync(outDir, { recursive: true });
    const stamp = now.toISOString().slice(0, 10);
    const outPath = join(outDir, `defect-escape-${stamp}.md`);
    writeFileSync(outPath, report, 'utf8');
    process.stderr.write(`\n> wrote ${outPath}\n`);
  }
}

main();
