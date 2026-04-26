/**
 * Print every Feedback event that scored Sendero agent #2286 on the
 * ERC-8004 Reputation Registry. Tells us who rated us and what they gave.
 *
 * Run:  bun scripts/who-rated-our-agent.ts
 */

import { createPublicClient, http } from 'viem';

const REPUTATION_REGISTRY = '0x8004B663056A597Dffe9eCcC1965A193B7388713' as const;
const FEEDBACK_TOPIC0 =
  '0x0a18b3636bf76d4ee9c2c814fe2a82d0aaef72d6f7a2bbb4cd3aa42e30ba87fe' as const;

const arc = createPublicClient({
  transport: http(process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network'),
});

async function main() {
  const agentId = BigInt(process.env.SENDERO_AGENT_ID || '2286');
  const agentIdPadded = ('0x' + agentId.toString(16).padStart(64, '0')) as `0x${string}`;

  // Try the canonical event signature first; fall back to wide scan if 0 found.
  const latest = await arc.getBlockNumber();
  const CHUNK = 10_000n;
  const MAX_CHUNKS = 50;
  const logs: any[] = [];
  let to = latest;
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const from = to > CHUNK ? to - CHUNK : 0n;
    try {
      const chunk = await arc.getLogs({
        address: REPUTATION_REGISTRY,
        fromBlock: from,
        toBlock: to,
        topics: [FEEDBACK_TOPIC0 as any, agentIdPadded as any],
      } as any);
      logs.push(...(chunk as any[]));
    } catch (err) {
      console.warn(`  chunk ${from}-${to} failed:`, (err as Error).message);
    }
    if (from === 0n) break;
    to = from - 1n;
  }

  console.log(`agent #${agentId} · ${logs.length} feedback event(s)\n`);
  if (logs.length === 0) {
    // Wider scan — just dump everything from the registry that mentions our id.
    console.log('Trying wide scan (no topic0 filter)…');
    const wide = await arc.getLogs({
      address: REPUTATION_REGISTRY,
      fromBlock: 0n,
      toBlock: latest,
      topics: [null, agentIdPadded as any],
    } as any);
    console.log(`Wide: ${(wide as any[]).length} hits`);
    for (const l of wide as any[]) {
      console.log(`  block=${l.blockNumber}  tx=${l.transactionHash.slice(0, 12)}…`);
      console.log(`    topics: ${JSON.stringify(l.topics)}`);
      console.log(`    data:   ${l.data}`);
    }
    return;
  }

  for (const l of logs) {
    const validatorTopic = (l as any).topics?.[2] as string | undefined;
    const validator = validatorTopic ? '0x' + validatorTopic.slice(-40).toLowerCase() : '?';
    const data = (l as any).data as string;
    let score = 0;
    if (data && data.length >= 130) {
      try {
        score = Number(BigInt('0x' + data.slice(66, 130)));
      } catch {}
    }
    console.log(
      `block=${(l as any).blockNumber}  validator=${validator}  score=${score}/100  tx=${(l as any).transactionHash}`
    );
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
