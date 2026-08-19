import chalk from 'chalk';
import {
  deleteRecording,
  listRecordings,
  readRecording,
  readTranscript,
  searchTranscripts,
} from '../ops/recordings.ts';
import { transcribeEnvironment, transcribeRecording } from '../ops/transcribe.ts';
import { formatTimestamp } from '../stt/whisper.ts';
import { cliContext } from './context.ts';

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
    process.stdout.write(
      `${chalk.bold(hit.id)} ${chalk.dim(formatTimestamp(hit.start))}  ${hit.text}\n`,
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

  const ready = Boolean(env.ffmpeg && env.bin && env.model);
  process.stdout.write(
    ready
      ? `\n${chalk.green('Ready')} — recordings can be transcribed locally.\n`
      : `\n${chalk.yellow('Not ready')} — recording still works; transcription will be refused until the above is fixed.\n`,
  );
  if (!ready) process.exitCode = 1;
}
