import { Command } from 'commander';

import { activeProfileName, clearKey, paths, readKey, setActiveProfile } from '../config/store';
import { loginWithBrowser, loginWithPaste } from '../client/auth';
import { makeClient, whoami } from '../client/api';
import { resolveFormat, type GlobalFlags } from '../output/formatter';
import { c, printDetail, printError, printJson, printSuccess, printWhatsNext } from '../output/print';
import { withSpinner } from '../ui/spinner';

export function createAuthCommand(): Command {
  const auth = new Command('auth').description('Sign in, sign out, check who you are');

  auth
    .command('login')
    .description('Authenticate with Sendero (opens browser by default)')
    .option('--no-browser', 'Skip browser flow; paste an API key from the dashboard')
    .option('--profile <name>', 'Save the key under a named profile (default: current active profile)')
    .addHelpText(
      'after',
      `
Examples:
  sendero auth login                          # Browser OAuth (recommended)
  sendero auth login --no-browser             # Manual paste fallback
  sendero auth login --profile prod           # Save under "prod" profile
  SENDERO_API_KEY=ak_xxx sendero ...          # Skip login entirely
  SENDERO_PROFILE=prod sendero tools list     # One-off profile override`
    )
    .action(async (opts: { browser?: boolean; profile?: string }) => {
      const globals = auth.parent?.opts() as GlobalFlags;
      const apiUrl = globals.apiUrl ?? process.env.SENDERO_API_URL ?? 'https://app.sendero.travel';

      // If --profile is set, switch to it BEFORE the login flow so the
      // resulting key writes to the requested profile, not whatever was
      // active before. We can't call setActiveProfile() yet because the
      // profile might not exist on disk; instead, set the env override
      // for the duration of this process.
      if (opts.profile) {
        process.env.SENDERO_PROFILE = opts.profile;
      }

      try {
        const result = opts.browser === false
          ? await loginWithPaste({ apiUrl })
          : await loginWithBrowser({ apiUrl, quiet: globals.quiet });

        // After a successful login under a named profile, also flip the
        // current pointer so subsequent commands without --profile use it.
        // Skip when no --profile flag (we wrote to the existing active).
        if (opts.profile) {
          try {
            setActiveProfile(opts.profile);
          } catch {
            // Profile file write succeeded but setActive failed — surface
            // but don't fail the whole login.
            process.stderr.write(
              `[sendero] Note: key saved but could not flip active profile to "${opts.profile}". Run \`sendero profiles use ${opts.profile}\` manually.\n`
            );
          }
        }

        const client = makeClient({ baseUrl: apiUrl, debug: globals.debug });
        const me = await withSpinner(
          'Verifying...',
          () => whoami(client),
          { quiet: globals.quiet, agent: globals.agent }
        );

        if (resolveFormat(globals) === 'json') {
          printJson({ ok: true, via: result.via, ...me });
          return;
        }

        const profileName = activeProfileName();
        printSuccess(`Signed in as ${c.bold(me.tenantId)}${opts.profile ? ` (profile: ${c.bold(profileName)})` : ''}`);
        printDetail([
          { label: 'Tenant', value: me.tenantId },
          { label: 'Org', value: me.orgId },
          { label: 'Profile', value: profileName },
          { label: 'Key type', value: `${me.effectiveKeyType}${me.keyType !== me.effectiveKeyType ? ` (downgraded from ${me.keyType})` : ''}` },
          { label: 'Scopes', value: me.scopes.join(', ') || c.dim('(none)') },
          { label: 'Saved to', value: c.dim(paths.profile(profileName)) },
        ]);
        printWhatsNext([
          { command: 'sendero tools list', description: 'see what you can call' },
          { command: 'sendero mcp install', description: 'wire Sendero into Claude Code' },
        ]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        printError({
          problem: 'Login failed',
          cause: message,
          fix: 'Try `sendero auth login --no-browser` to use manual paste, or check your network.',
          docs: 'https://docs.sendero.travel/cli/auth',
        });
        process.exit(1);
      }
    });

  auth
    .command('logout')
    .description('Forget the saved key')
    .action(async () => {
      const globals = auth.parent?.opts() as GlobalFlags;
      const hadKey = readKey() !== null;
      clearKey();
      if (resolveFormat(globals) === 'json') {
        printJson({ ok: true, hadKey });
        return;
      }
      if (hadKey) printSuccess('Signed out.');
      else process.stdout.write('Already signed out.\n');
    });

  auth
    .command('whoami')
    .description('Print the current tenant + scopes')
    .action(async () => {
      const globals = auth.parent?.opts() as GlobalFlags;
      const apiUrl = globals.apiUrl ?? process.env.SENDERO_API_URL ?? 'https://app.sendero.travel';
      const key = readKey();
      if (!key) {
        printError({
          problem: 'Not signed in',
          fix: 'Run `sendero auth login`',
          docs: 'https://docs.sendero.travel/cli/auth',
        });
        process.exit(1);
      }
      const client = makeClient({ baseUrl: apiUrl, debug: globals.debug });
      try {
        const me = await whoami(client);
        if (resolveFormat(globals) === 'json') {
          printJson(me);
          return;
        }
        printDetail([
          { label: 'Tenant', value: me.tenantId },
          { label: 'Org', value: me.orgId },
          { label: 'Key type', value: me.effectiveKeyType },
          { label: 'Scopes', value: me.scopes.join(', ') || c.dim('(none)') },
        ]);
      } catch (err) {
        const e = err as { status?: number; message?: string };
        if (e.status === 401) {
          printError({
            problem: 'Stored key is invalid or expired',
            fix: 'Run `sendero auth login` again',
          });
        } else {
          printError({ problem: 'whoami failed', cause: e.message });
        }
        process.exit(1);
      }
    });

  return auth;
}
