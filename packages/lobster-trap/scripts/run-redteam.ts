import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  SENDERO_LOBSTER_TRAP_POLICY_PATH,
  parseInspectAction,
  redTeamFixturePassed,
  senderoRedTeamFixtures,
} from '../src';

const binary = process.env.LOBSTERTRAP_BIN ?? '.context/lobstertrap-upstream/lobstertrap';
const policy = process.env.LOBSTERTRAP_POLICY ?? SENDERO_LOBSTER_TRAP_POLICY_PATH;
const resolvedBinary = resolveWorkspacePath(binary);
const resolvedPolicy = resolveWorkspacePath(policy);

if (!existsSync(resolvedBinary)) {
  console.error(`Missing Lobster Trap binary at ${resolvedBinary}`);
  console.error(
    'Build it with: git clone https://github.com/veeainc/lobstertrap.git .context/lobstertrap-upstream && make -C .context/lobstertrap-upstream build'
  );
  process.exit(1);
}

let failures = 0;

for (const fixture of senderoRedTeamFixtures) {
  const result = spawnSync(
    resolvedBinary,
    ['inspect', fixture.prompt, '--policy', resolvedPolicy],
    {
      encoding: 'utf8',
    }
  );
  const output = `${result.stdout}\n${result.stderr}`;
  const observedAction = parseInspectAction(output);
  const passed = redTeamFixturePassed({
    expectedAction: fixture.expectedAction,
    observedAction,
  });

  if (!passed) failures += 1;
  console.log(
    `${passed ? 'PASS' : 'FAIL'} ${fixture.id}: expected=${fixture.expectedAction} observed=${observedAction ?? 'UNKNOWN'}`
  );
}

if (failures > 0) process.exit(1);

function resolveWorkspacePath(path: string): string {
  if (path.startsWith('/')) return path;
  const candidates = [
    resolve(process.cwd(), path),
    resolve(process.cwd(), '../..', path),
    resolve(process.cwd(), '../../..', path),
  ];
  return candidates.find(candidate => existsSync(candidate)) ?? candidates[0];
}
