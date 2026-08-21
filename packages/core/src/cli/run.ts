import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { Command, Option } from 'commander';

async function readVersion(): Promise<string> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/cli/bin.js → ../../package.json
  const raw = await readFile(path.resolve(here, '..', '..', 'package.json'), 'utf8');
  return (JSON.parse(raw) as { version: string }).version;
}

export function parsePort(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(`Invalid port: ${value}`);
  return n;
}

export async function run(argv: string[]): Promise<void> {
  const program = new Command();
  program
    .name('open-recording')
    .description('Record in the browser, transcribe locally, drive both from an agent.')
    .version(await readVersion(), '-v, --version', 'print version')
    .helpOption('-h, --help', 'show help')
    .showHelpAfterError(chalk.dim('(run `open-recording --help` for usage)'));

  program
    .command('dev')
    .description('Start the studio dev server')
    .addOption(new Option('-p, --port <port>', 'port to listen on').argParser(parsePort))
    .addOption(new Option('--host [host]', 'expose on the network (optional host)'))
    .option('--open', 'open the browser on start')
    .option('--mcp', 'serve an MCP endpoint at /mcp (requires @open-recording/mcp)')
    .action(async (flags) => {
      const { dev } = await import('./dev.ts');
      await dev(flags);
    });

  program
    .command('list')
    .description('List recordings')
    .option('--json', 'print as JSON')
    .action(async (flags) => {
      const { listCommand } = await import('./commands.ts');
      await listCommand(flags);
    });

  program
    .command('show <id>')
    .description('Print a recording’s transcript')
    .option('--json', 'print metadata and segments as JSON')
    .action(async (id: string, flags) => {
      const { showCommand } = await import('./commands.ts');
      await showCommand(id, flags);
    });

  program
    .command('transcribe [ids...]')
    .description('Transcribe recordings with local whisper.cpp')
    .option('--all', 'every recording that has no transcript yet')
    .option('--force', 're-transcribe even when a transcript exists')
    .option('-l, --language <code>', 'language code, or `auto`')
    .option('-m, --model <path>', 'path to a ggml model')
    .action(async (ids: string[], flags) => {
      const { transcribeCommand } = await import('./commands.ts');
      await transcribeCommand(ids, flags);
    });

  program
    .command('search <query>')
    .description('Search stored transcripts')
    .option('--limit <n>', 'maximum hits', (v: string) => Number.parseInt(v, 10))
    .action(async (query: string, flags) => {
      const { searchCommand } = await import('./commands.ts');
      await searchCommand(query, flags);
    });

  program
    .command('repair [ids...]')
    .description('Rewrite a recording’s container so players can scrub it')
    .option('--all', 'every finished recording')
    .action(async (ids: string[], flags) => {
      const { repairCommand } = await import('./commands.ts');
      await repairCommand(ids, flags);
    });

  program
    .command('rm <ids...>')
    .description('Delete recordings')
    .action(async (ids: string[]) => {
      const { removeCommand } = await import('./commands.ts');
      await removeCommand(ids);
    });

  program
    .command('doctor')
    .description('Check ffmpeg, whisper.cpp, and the model the transcriber needs')
    .action(async () => {
      const { doctorCommand } = await import('./commands.ts');
      await doctorCommand();
    });

  await program.parseAsync(argv, { from: 'user' });
}
