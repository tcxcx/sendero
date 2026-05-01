import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const flowsDir = resolve(root, 'flows');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function collectScreenIds(flow) {
  return new Set((flow.screens || []).map(screen => screen.id));
}

for (const file of await readdir(flowsDir)) {
  if (!file.endsWith('.flow.json')) continue;
  const flow = JSON.parse(await readFile(resolve(flowsDir, file), 'utf8'));
  assert(flow.version === '7.3', `${file}: expected version 7.3`);
  assert(flow.data_api_version === '3.0', `${file}: expected data_api_version 3.0`);
  assert(
    flow.routing_model && typeof flow.routing_model === 'object',
    `${file}: routing_model missing`
  );
  assert(Array.isArray(flow.screens) && flow.screens.length > 0, `${file}: screens missing`);
  const screenIds = collectScreenIds(flow);
  for (const [screenId, targets] of Object.entries(flow.routing_model)) {
    assert(screenIds.has(screenId), `${file}: routing source ${screenId} missing`);
    assert(Array.isArray(targets), `${file}: routing targets for ${screenId} must be an array`);
    for (const target of targets) {
      assert(screenIds.has(target), `${file}: routing target ${target} missing`);
    }
  }
  for (const screen of flow.screens) {
    assert(screen.id && typeof screen.id === 'string', `${file}: screen id missing`);
    assert(
      screen.layout?.type === 'SingleColumnLayout',
      `${file}: ${screen.id} must use SingleColumnLayout`
    );
    assert(Array.isArray(screen.layout.children), `${file}: ${screen.id} children missing`);
  }
}

console.log(JSON.stringify({ ok: true }, null, 2));
