import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const claudePath = resolve(root, 'CLAUDE.md');
const hookPath = resolve(root, 'lefthook.yml');
const scriptPath = resolve(root, 'scripts/check-responsible-ai.ts');

const REQUIRED_DOC_URL =
  'https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/responsible-ai';

const REQUIRED_POLICY_TERMS = [
  'Google Cloud Responsible AI ship gate',
  REQUIRED_DOC_URL,
  'Security risks',
  'Safety testing',
  'Grounding/factuality',
  'Privacy/security',
  'Human supervision',
  'Language/fairness',
  'Monitoring/feedback',
];

const REQUIRED_HOOK_TERMS = ['responsible-ai-check', 'scripts/check-responsible-ai.ts'];

function readRequired(path: string): string {
  if (!existsSync(path)) {
    console.error(`x missing required Responsible AI file: ${path}`);
    process.exit(1);
  }
  return readFileSync(path, 'utf8');
}

function assertContains(label: string, text: string, terms: string[]): void {
  const missing = terms.filter(term => !text.includes(term));
  if (!missing.length) return;

  console.error(`x Responsible AI guard is incomplete in ${label}`);
  for (const term of missing) {
    console.error(`  missing: ${term}`);
  }
  process.exit(1);
}

const claude = readRequired(claudePath);
const hook = readRequired(hookPath);
const script = readRequired(scriptPath);

assertContains('CLAUDE.md', claude, REQUIRED_POLICY_TERMS);
assertContains('lefthook.yml', hook, REQUIRED_HOOK_TERMS);
assertContains('check-responsible-ai.ts', script, [REQUIRED_DOC_URL, 'REQUIRED_POLICY_TERMS']);

console.log('✓ Google Cloud Responsible AI ship gate present');
