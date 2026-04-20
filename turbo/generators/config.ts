/**
 * Turborepo code generators.
 *
 * Usage:
 *   bun turbo gen package   — scaffold a new @sendero/<name> package
 *   bun turbo gen app       — scaffold a new Next.js 16 app under apps/<name>
 *
 * Both generators match the conventions the monorepo is already using:
 *   - biome + TypeScript
 *   - tsconfig extends root
 *   - path aliases threaded via root tsconfig (packages) or per-app
 *     tsconfig (apps)
 */

import type { PlopTypes } from '@turbo/gen';

export default function generator(plop: PlopTypes.NodePlopAPI): void {
  plop.setGenerator('package', {
    description: 'Scaffold a new @sendero/<name> package',
    prompts: [
      {
        type: 'input',
        name: 'name',
        message: 'Package name (without @sendero/ prefix):',
        validate: (input: string) =>
          /^[a-z][a-z0-9-]+$/.test(input) || 'lowercase, letters/numbers/dashes',
      },
      {
        type: 'input',
        name: 'description',
        message: 'One-line description:',
      },
    ],
    actions: [
      {
        type: 'add',
        path: 'packages/{{name}}/package.json',
        templateFile: 'templates/package.json.hbs',
      },
      {
        type: 'add',
        path: 'packages/{{name}}/tsconfig.json',
        templateFile: 'templates/package.tsconfig.json.hbs',
      },
      {
        type: 'add',
        path: 'packages/{{name}}/src/index.ts',
        templateFile: 'templates/package.index.ts.hbs',
      },
    ],
  });

  plop.setGenerator('app', {
    description: 'Scaffold a new Next.js 16 app under apps/<name>',
    prompts: [
      {
        type: 'input',
        name: 'name',
        message: 'App name (becomes apps/<name> and @sendero/<name>):',
        validate: (input: string) =>
          /^[a-z][a-z0-9-]+$/.test(input) || 'lowercase, letters/numbers/dashes',
      },
      {
        type: 'input',
        name: 'description',
        message: 'One-line description:',
      },
      {
        type: 'input',
        name: 'port',
        message: 'Dev port (e.g. 3013):',
        default: '3013',
      },
    ],
    actions: [
      {
        type: 'add',
        path: 'apps/{{name}}/package.json',
        templateFile: 'templates/app.package.json.hbs',
      },
      {
        type: 'add',
        path: 'apps/{{name}}/tsconfig.json',
        templateFile: 'templates/app.tsconfig.json.hbs',
      },
      {
        type: 'add',
        path: 'apps/{{name}}/next.config.mjs',
        templateFile: 'templates/app.next.config.mjs.hbs',
      },
      {
        type: 'add',
        path: 'apps/{{name}}/app/layout.tsx',
        templateFile: 'templates/app.layout.tsx.hbs',
      },
      {
        type: 'add',
        path: 'apps/{{name}}/app/page.tsx',
        templateFile: 'templates/app.page.tsx.hbs',
      },
      {
        type: 'add',
        path: 'apps/{{name}}/app/globals.css',
        templateFile: 'templates/app.globals.css.hbs',
      },
    ],
  });
}
