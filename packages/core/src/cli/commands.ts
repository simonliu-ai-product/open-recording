import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { importRecording } from '../ops/import.ts';
import {
  deleteRecording,
  listRecordings,
  readRecording,
  readTranscript,
  searchTranscripts,
} from '../ops/recordings.ts';
import { repairRecording } from '../ops/session.ts';
import { transcribeEnvironment, transcribeRecording } from '../ops/transcribe.ts';
import { formatTimestamp } from '../stt/whisper.ts';
import { cliContext } from './context.ts';

function packageSkillsDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (dir !== path.dirname(dir)) {
    const candidate = path.join(dir, 'skills');
    if (existsSync(candidate) && existsSync(path.join(dir, 'package.json'))) {
      return candidate;
    }
    dir = path.dirname(dir);
  }
  throw new Error('open-recording: canonical skills directory not found');
}

export async function listCommand(flags: { json?: boolean } = {}): Promise<void> {
  const ctx = await cliContext();
  const recordings = await listRecordings(ctx);
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(recordings, null, 2)}\n`);
    return;
  }
  if (recordings.length === 0) {
    process.stdout.write(chalk.dim('No recordings yet.\n'));
    return;
  }
  for (const recording of recordings) {
    const mark = recording.transcribed ? chalk.green('✓') : chalk.dim('·');
    process.stdout.write(
      `${mark} ${chalk.bold(recording.id)}  ${formatTimestamp(recording.durationMs).padStart(7)}  ${recording.title}\n`,
    );
  }
}

export async function showCommand(id: string, flags: { json?: boolean } = {}): Promise<void> {
  const ctx = await cliContext();
  if (flags.json) {
    const meta = await readRecording(ctx, id);
    const transcript = await readTranscript(ctx, id, 'segments').catch(() => null);
    process.stdout.write(`${JSON.stringify({ ...meta, transcript }, null, 2)}\n`);
    return;
  }
  const markdown = await readTranscript(ctx, id, 'markdown');
  process.stdout.write(`${String(markdown)}\n`);
}

export async function importCommand(
  file: string,
  flags: { title?: string; tag?: string[]; transcribe?: boolean; language?: string } = {},
): Promise<void> {
  const ctx = await cliContext();
  const meta = await importRecording(ctx, {
    filePath: file,
    ...(flags.title ? { title: flags.title } : {}),
    ...(flags.tag && flags.tag.length > 0 ? { tags: flags.tag } : {}),
    ...(flags.transcribe ? { transcribe: true } : {}),
    ...(flags.language ? { language: flags.language } : {}),
    source: 'agent',
  });
  process.stdout.write(
    `${chalk.green('✓')} imported ${chalk.bold(meta.id)} (${formatTimestamp(meta.durationMs)}) — ${meta.title}\n`,
  );
}

export async function syncSkillsCommand(targetDir = process.cwd()): Promise<string[]> {
  const srcRoot = packageSkillsDir();
  const entries = await readdir(srcRoot, { withFileTypes: true });
  const skills = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  const targets = [
    path.join(targetDir, '.claude', 'skills'),
    path.join(targetDir, '.agents', 'skills'),
  ];
  for (const destRoot of targets) {
    await mkdir(destRoot, { recursive: true });
    for (const skill of skills) {
      await cp(path.join(srcRoot, skill), path.join(destRoot, skill), {
        recursive: true,
        force: true,
      });
    }
  }
  return skills;
}

export async function initCommand(dir = '.'): Promise<void> {
  const root = path.resolve(process.cwd(), dir);
  await mkdir(path.join(root, 'recordings'), { recursive: true });
  const configPath = path.join(root, 'open-recording.config.ts');
  if (!existsSync(configPath)) {
    await writeFile(
      configPath,
      [
        "import type { OpenRecordingConfig } from '@open-recording/core';",
        '',
        'export default {',
        "  recordingsDir: 'recordings',",
        '  port: 5274,',
        '  transcribe: {',
        "    language: 'auto',",
        "    vocabulary: ['open-recording', 'MCP', 'Vite', 'Whisper'],",
        '  },',
        '} satisfies OpenRecordingConfig;',
        '',
      ].join('\n'),
      'utf8',
    );
  }
  const guide = [
    '# open-recording Workspace',
    '',
    '- Start studio + MCP server: `npx open-recording dev --mcp`',
    '- Connect MCP client to `http://localhost:5274/mcp`',
    '- Recordings live in `recordings/<id>/` (`meta.json`, `audio.webm`, `transcript.md`, `notes.md`).',
    '',
  ].join('\n');
  for (const name of ['CLAUDE.md', 'AGENTS.md']) {
    const p = path.join(root, name);
    if (!existsSync(p)) await writeFile(p, guide, 'utf8');
  }
  const synced = await syncSkillsCommand(root);
  process.stdout.write(
    `${chalk.green('✓')} initialized open-recording workspace in ${root} (${synced.length} skills synced)\n`,
  );
}

export async function transcribeCommand(
  ids: string[],
  flags: { all?: boolean; force?: boolean; language?: string; model?: string } = {},
): Promise<void> {
  const ctx = await cliContext();
  const targets = flags.all
    ? (await listRecordings(ctx)).filter((r) => flags.force || !r.transcribed).map((r) => r.id)
    : ids;
  if (targets.length === 0) {
    process.stdout.write(chalk.dim('Nothing to transcribe.\n'));
    return;
  }

  for (const id of targets) {
    process.stdout.write(`${chalk.dim('…')} ${id}\n`);
    const result = await transcribeRecording(ctx, id, {
      ...(flags.force ? { force: true } : {}),
      ...(flags.language ? { language: flags.language } : {}),
      ...(flags.model ? { model: flags.model } : {}),
    });
    process.stdout.write(
      `${chalk.green('✓')} ${id} — ${result.segmentCount} segments, ${result.language}, ${(result.elapsedMs / 1000).toFixed(1)}s\n`,
    );
  }
}

export async function searchCommand(query: string, flags: { limit?: number } = {}): Promise<void> {
  const ctx = await cliContext();
  const hits = await searchTranscripts(ctx, query, flags.limit ?? 20);
  if (hits.length === 0) {
    process.stdout.write(chalk.dim('No matches.\n'));
    return;
  }
  for (const hit of hits) {
    const who = hit.speaker ? chalk.cyan(`[${hit.speaker}] `) : '';
    process.stdout.write(
      `${chalk.bold(hit.id)} ${chalk.dim(formatTimestamp(hit.start))}  ${who}${hit.text}\n`,
    );
  }
}

/** Rewrites the container of recordings made before the remux existed. */
export async function repairCommand(ids: string[], flags: { all?: boolean } = {}): Promise<void> {
  const ctx = await cliContext();
  const targets = flags.all
    ? (await listRecordings(ctx)).filter((r) => r.status === 'ready').map((r) => r.id)
    : ids;
  if (targets.length === 0) {
    process.stdout.write(chalk.dim('Nothing to repair.\n'));
    return;
  }

  for (const id of targets) {
    const result = await repairRecording(ctx, id);
    process.stdout.write(
      result.seekable
        ? `${chalk.green('✓')} ${id} — ${formatTimestamp(result.durationMs)}, seekable\n`
        : `${chalk.yellow('!')} ${id} — could not be rewritten; the file is unchanged\n`,
    );
  }
}

export async function removeCommand(ids: string[]): Promise<void> {
  const ctx = await cliContext();
  for (const id of ids) {
    await deleteRecording(ctx, id);
    process.stdout.write(`${chalk.green('✓')} removed ${id}\n`);
  }
}

/** What `transcribe` needs and whether it is there. Every failure path prints its own fix. */
export async function doctorCommand(): Promise<void> {
  const ctx = await cliContext();
  const env = await transcribeEnvironment(ctx);
  const line = (ok: boolean, label: string, detail: string) =>
    process.stdout.write(
      `${ok ? chalk.green('✓') : chalk.red('✗')} ${label.padEnd(10)} ${detail}\n`,
    );

  line(Boolean(env.ffmpeg), 'ffmpeg', env.ffmpeg ?? chalk.dim('not found — brew install ffmpeg'));
  line(Boolean(env.bin), 'whisper', env.bin ?? chalk.dim('not found — brew install whisper-cpp'));
  line(
    Boolean(env.model),
    'model',
    env.model ??
      chalk.dim(
        `no ggml model found. Download one into ${env.modelSearchDirs[0]}:\n` +
          '             curl -L -o ggml-large-v3-turbo.bin \\\n' +
          '               https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin',
      ),
  );

  if (env.script !== 'as-is') {
    line(
      env.scriptConverter,
      'script',
      env.scriptConverter
        ? `${env.script} (opencc-js)`
        : chalk.dim(`transcripts are set to ${env.script} — pnpm add -D opencc-js`),
    );
  }

  const ready =
    Boolean(env.ffmpeg && env.bin && env.model) && (env.script === 'as-is' || env.scriptConverter);
  process.stdout.write(
    ready
      ? `\n${chalk.green('Ready')} — recordings can be transcribed locally.\n`
      : `\n${chalk.yellow('Not ready')} — recording still works; transcription will be refused until the above is fixed.\n`,
  );
  if (!ready) process.exitCode = 1;
}
