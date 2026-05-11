import { FUNCTION_SLUGS } from '../src/lib/constants.js';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();

async function exists(path) {
  await access(path);
}

async function validateFunction(slug) {
  const dir = resolve(root, 'functions', slug);
  const yaml = await readFile(resolve(dir, 'function.yaml'), 'utf8');
  const code = await readFile(resolve(dir, 'index.js'), 'utf8');
  if (!yaml.includes(`slug: ${slug}`)) throw new Error(`${slug} function.yaml slug mismatch`);
  if (!code.includes('async function handler(')) throw new Error(`${slug} missing handler`);
  if (!yaml.includes('function_type: cloudflare_worker')) {
    throw new Error(`${slug} must use the Cloudflare Worker function type`);
  }
  if (!yaml.includes('entrypoint: index.js')) throw new Error(`${slug} must upload index.js`);
  const forbiddenModuleSyntax = [
    /\bexport\s+/,
    /\bimport\s+/,
    /\bmodule\.exports\b/,
    /\bexports\./,
    /\brequire\s*\(/,
  ];
  if (forbiddenModuleSyntax.some(pattern => pattern.test(code))) {
    throw new Error(
      `${slug} must stay a plain Kapso Worker file: no imports, exports, CommonJS, or TS build step`
    );
  }
}

await exists(resolve(root, 'kapso.yaml'));
await Promise.all(Object.values(FUNCTION_SLUGS).map(validateFunction));

process.env.WHATSAPP_PHONE_NUMBER_ID ||= 'pn_validate';
const workflowModule = await import(
  `${pathToFileURL(resolve(root, 'workflows/sendero-tenant-travel-agent/workflow.js')).href}?t=${Date.now()}`
);
const workflow = workflowModule.default;
const validation = workflow.validate();
if (validation.errors?.length) {
  throw new Error(`workflow validation failed: ${validation.errors.join(', ')}`);
}

const source = workflow.toSourceFiles();
console.log(
  JSON.stringify(
    {
      ok: true,
      functions: Object.keys(FUNCTION_SLUGS).length,
      workflowNodes: source.definition.nodes.length,
      workflowEdges: source.definition.edges.length,
      workflowTriggers: source.metadata.triggers.length,
      warnings: validation.warnings?.length ?? 0,
    },
    null,
    2
  )
);
