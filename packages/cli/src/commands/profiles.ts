import { Command } from 'commander';

import { activeProfileName, deleteProfile, listProfiles, paths, readProfile, setActiveProfile } from '../config/store';
import { resolveFormat, type GlobalFlags } from '../output/formatter';
import { c, printDetail, printError, printJson, printSuccess, printText } from '../output/print';

export function createProfilesCommand(): Command {
  const profiles = new Command('profiles').description(
    'Manage credential profiles (multi-tenant key switching)'
  );

  profiles
    .command('list')
    .alias('ls')
    .description('List all stored profiles')
    .action(() => {
      const globals = profiles.parent?.opts() as GlobalFlags;
      const all = listProfiles();
      const active = activeProfileName();

      if (resolveFormat(globals) === 'json') {
        printJson({ active, profiles: all });
        return;
      }

      if (all.length === 0) {
        printText(c.dim('No profiles yet. Run `sendero auth login` to create one.'));
        return;
      }

      printText(`${c.bold(String(all.length))} profile${all.length === 1 ? '' : 's'}:`);
      for (const name of all) {
        const marker = name === active ? c.green('●') : ' ';
        const profile = readProfile(name);
        const url = profile?.apiUrl ? c.dim(` (${profile.apiUrl})`) : '';
        printText(`  ${marker} ${name === active ? c.bold(name) : name}${url}`);
      }
    });

  profiles
    .command('use <name>')
    .description('Switch the active profile')
    .action((name: string) => {
      const globals = profiles.parent?.opts() as GlobalFlags;
      try {
        setActiveProfile(name);
        if (resolveFormat(globals) === 'json') {
          printJson({ ok: true, active: name });
          return;
        }
        printSuccess(`Active profile: ${c.bold(name)}`);
      } catch (err) {
        printError({
          problem: `Could not switch to profile "${name}"`,
          cause: err instanceof Error ? err.message : String(err),
          fix: `Run \`sendero auth login --profile ${name}\` to create it first.`,
        });
        process.exit(1);
      }
    });

  profiles
    .command('delete <name>')
    .alias('rm')
    .description('Delete a profile (cannot undo)')
    .action((name: string) => {
      const globals = profiles.parent?.opts() as GlobalFlags;
      const removed = deleteProfile(name);
      if (resolveFormat(globals) === 'json') {
        printJson({ ok: removed, removed });
        return;
      }
      if (removed) printSuccess(`Deleted profile ${c.bold(name)}`);
      else printText(c.dim(`Profile "${name}" did not exist.`));
    });

  profiles
    .command('show')
    .description('Show the active profile (without revealing the key)')
    .action(() => {
      const globals = profiles.parent?.opts() as GlobalFlags;
      const name = activeProfileName();
      const profile = readProfile(name);
      if (!profile) {
        printError({
          problem: `Active profile "${name}" has no stored credentials`,
          fix: `Run \`sendero auth login${name === 'default' ? '' : ` --profile ${name}`}\``,
        });
        process.exit(1);
      }
      const masked = `${profile.apiKey.slice(0, 6)}…${profile.apiKey.slice(-4)}`;

      if (resolveFormat(globals) === 'json') {
        printJson({
          name,
          apiKeyMasked: masked,
          apiUrl: profile.apiUrl ?? null,
          mintedAt: profile.mintedAt ?? null,
          path: paths.profile(name),
        });
        return;
      }

      printDetail([
        { label: 'Profile', value: c.bold(name) },
        { label: 'Key', value: `${masked} ${c.dim('(redacted)')}` },
        { label: 'API URL', value: profile.apiUrl ?? c.dim('(default)') },
        { label: 'Minted', value: profile.mintedAt ?? c.dim('(unknown)') },
        { label: 'File', value: c.dim(paths.profile(name)) },
      ]);
    });

  return profiles;
}
