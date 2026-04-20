/**
 * Quick probe: verify the live reputation aggregator works.
 * Run: `bun run scripts/check-reputation.ts`
 */
import { getReputation, invalidateReputationCache } from '../lib/arc-identity';
import fs from 'node:fs';
import path from 'node:path';

// Load .env.local manually
const envPath = path.join(import.meta.dir, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const eq = line.indexOf('=');
    if (eq < 0 || line.trim().startsWith('#')) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (key && !process.env[key]) process.env[key] = value;
  }
}

const agentIdStr = process.env.SENDERO_AGENT_ID;
if (!agentIdStr) {
  console.error('SENDERO_AGENT_ID not set in .env.local');
  process.exit(1);
}

invalidateReputationCache();
const rep = await getReputation(BigInt(agentIdStr));
console.log('Reputation for agent #' + agentIdStr + ':');
console.log('  stars:      ' + rep.stars.toFixed(2));
console.log('  mean score: ' + rep.meanScore.toFixed(2));
console.log('  events:     ' + rep.count);
console.log('  validators: ' + rep.validators);
