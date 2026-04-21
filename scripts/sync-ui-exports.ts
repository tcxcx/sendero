#!/usr/bin/env bun
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const UI_DIR = join(ROOT, 'packages', 'ui');
const COMPONENTS_DIR = join(UI_DIR, 'src', 'components');
const HOOKS_DIR = join(UI_DIR, 'src', 'hooks');
const PKG_PATH = join(UI_DIR, 'package.json');

const fixedExports: Record<string, string> = {
  './globals.css': './src/globals.css',
  './tailwind.config': './tailwind.config.ts',
  './cn': './src/utils/cn.ts',
};

async function dirExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function main() {
  const dynamic: Record<string, string> = {};

  if (await dirExists(COMPONENTS_DIR)) {
    const files = (await readdir(COMPONENTS_DIR))
      .filter(file => file.endsWith('.tsx') && !file.endsWith('.test.tsx'))
      .sort();
    for (const file of files) {
      const name = file.replace(/\.tsx$/, '');
      dynamic[`./${name}`] = `./src/components/${file}`;
    }
  }

  if (await dirExists(HOOKS_DIR)) {
    const files = (await readdir(HOOKS_DIR))
      .filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .sort();
    for (const file of files) {
      const name = file.replace(/\.ts$/, '');
      dynamic[`./hooks/${name}`] = `./src/hooks/${file}`;
    }
  }

  const pkg = JSON.parse(await readFile(PKG_PATH, 'utf8'));
  pkg.exports = { ...fixedExports, ...dynamic };
  await writeFile(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`synced ${Object.keys(dynamic).length} dynamic exports`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
