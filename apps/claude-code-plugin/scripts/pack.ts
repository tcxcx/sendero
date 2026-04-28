#!/usr/bin/env bun
/**
 * Pack the Sendero Claude Code plugin into a distributable zip.
 *
 * Output: dist/sendero-claude-code-plugin-<version>.zip
 *
 * Mirrors apps/mcpb/scripts/build.ts in spirit — single-shot bundler
 * that produces an artifact for /downloads/sendero-claude-code-plugin.zip
 * (served by the marketing site as a one-line install convenience).
 *
 * Pass --check to validate the manifest + .mcp.json without packing.
 */

import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = join(ROOT, 'dist');

function fail(msg: string): never {
  console.error(`[pack] ${msg}`);
  process.exit(1);
}

function readJson<T>(path: string): T {
  if (!existsSync(path)) fail(`missing ${path}`);
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

interface PluginManifest {
  name: string;
  version?: string;
  description?: string;
}

function validate(): { name: string; version: string } {
  const manifestPath = join(ROOT, '.claude-plugin/plugin.json');
  const mcpPath = join(ROOT, '.mcp.json');
  const skillPath = join(ROOT, 'skills/travel-booking/SKILL.md');

  const manifest = readJson<PluginManifest>(manifestPath);
  if (!manifest.name) fail('plugin.json: name is required');
  if (!manifest.version) fail('plugin.json: version is required for packed releases');
  if (!manifest.description) fail('plugin.json: description is required');

  if (!existsSync(mcpPath)) fail('missing .mcp.json — plugin must bundle the MCP server config');
  const mcp = readJson<{ mcpServers?: Record<string, { url?: string }> }>(mcpPath);
  if (!mcp.mcpServers?.sendero?.url) fail('.mcp.json: mcpServers.sendero.url is required');

  if (!existsSync(skillPath)) fail('missing skills/travel-booking/SKILL.md');
  const skill = readFileSync(skillPath, 'utf8');
  if (!skill.startsWith('---')) fail('SKILL.md must start with YAML frontmatter');
  if (!/description:/m.test(skill)) fail('SKILL.md frontmatter missing description');

  return { name: manifest.name, version: manifest.version };
}

function pack(name: string, version: string): void {
  if (!existsSync(DIST)) mkdirSync(DIST, { recursive: true });
  const zipPath = join(DIST, `${name}-claude-code-plugin-${version}.zip`);

  // Use the system `zip` binary — bun has no built-in zip writer.
  // Exclude node_modules, dist itself, and any local-only files.
  const args = [
    '-r',
    '-q',
    zipPath,
    '.claude-plugin',
    '.mcp.json',
    'skills',
    'icons',
    'README.md',
    'package.json',
    '-x',
    'dist/*',
    '-x',
    'node_modules/*',
    '-x',
    'scripts/*',
  ];
  const res = spawnSync('zip', args, { cwd: ROOT, stdio: 'inherit' });
  if (res.status !== 0) fail(`zip exited with status ${res.status}`);

  const size = statSync(zipPath).size;
  console.log(`[pack] ${zipPath}  (${(size / 1024).toFixed(1)} kB)`);
}

const check = process.argv.includes('--check');
const { name, version } = validate();
console.log(`[pack] ${name}@${version} — manifest + .mcp.json + skill validated`);
if (!check) pack(name, version);
