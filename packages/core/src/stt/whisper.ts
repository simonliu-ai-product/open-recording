import { existsSync } from 'node:fs';
import { readdir, readFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { run, toWhisperWav } from '../audio/ffmpeg.ts';
import type { TranscribeConfig } from '../config.ts';
import type { Transcript, TranscriptSegment } from '../files/store.ts';

const BIN_CANDIDATES = ['whisper-cli', 'whisper-cpp', 'main'];

const MODEL_DIRS = [
  path.join(homedir(), '.cache', 'whisper'),
  path.join(homedir(), '.cache', 'whisper-cpp'),
  path.join(homedir(), 'Library', 'Application Support', 'whisper'),
  '/opt/homebrew/share/whisper-cpp/models',
  '/usr/local/share/whisper-cpp/models',
];

/** Bigger is better here — the last entry wins when several models are present. */
const MODEL_PREFERENCE = ['tiny', 'base', 'small', 'medium', 'large-v3-turbo', 'large-v3', 'large'];

export type WhisperEnvironment = {
  bin: string | null;
  model: string | null;
  ffmpeg: string | null;
  modelSearchDirs: string[];
};

async function which(bin: string): Promise<string | null> {
  if (bin.includes(path.sep)) return existsSync(bin) ? bin : null;
  const result = await run(process.platform === 'win32' ? 'where' : 'which', [bin]).catch(
    () => null,
  );
  if (result?.code !== 0) return null;
  const first = result.stdout.split('\n')[0]?.trim();
  return first || null;
}

export async function resolveBin(config: TranscribeConfig = {}): Promise<string | null> {
  const explicit = config.bin ?? process.env.OPEN_RECORDING_WHISPER_BIN;
  if (explicit) return await which(explicit);
  for (const candidate of BIN_CANDIDATES) {
    const found = await which(candidate);
    if (found) return found;
  }
  return null;
}

function modelRank(file: string): number {
  const name = path.basename(file).toLowerCase();
  let rank = -1;
  MODEL_PREFERENCE.forEach((key, index) => {
    if (name.includes(key)) rank = Math.max(rank, index);
  });
  return rank;
}

export async function resolveModel(
  config: TranscribeConfig = {},
  userCwd?: string,
): Promise<string | null> {
  const explicit = config.model ?? process.env.OPEN_RECORDING_WHISPER_MODEL;
  if (explicit) {
    const abs = path.isAbsolute(explicit)
      ? explicit
      : path.resolve(userCwd ?? process.cwd(), explicit);
    return existsSync(abs) ? abs : null;
  }

  const dirs = [...(userCwd ? [path.join(userCwd, 'models')] : []), ...MODEL_DIRS];
  const found: string[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const entries = await readdir(dir).catch(() => []);
    for (const entry of entries) {
      if (entry.endsWith('.bin')) found.push(path.join(dir, entry));
    }
  }
  if (found.length === 0) return null;
  found.sort((a, b) => modelRank(a) - modelRank(b));
  return found[found.length - 1] ?? null;
}

export function modelSearchDirs(userCwd?: string): string[] {
  return [...(userCwd ? [path.join(userCwd, 'models')] : []), ...MODEL_DIRS];
}

export async function inspectEnvironment(
  config: TranscribeConfig = {},
  userCwd?: string,
): Promise<WhisperEnvironment> {
  return {
    bin: await resolveBin(config),
    model: await resolveModel(config, userCwd),
    ffmpeg: await which(config.ffmpeg ?? 'ffmpeg'),
    modelSearchDirs: modelSearchDirs(userCwd),
  };
}

type WhisperJson = {
  result?: { language?: string };
  transcription?: Array<{
    offsets?: { from?: number; to?: number };
    text?: string;
  }>;
};

/** whisper.cpp's `-oj` payload, reduced to the segments we keep. */
export function parseWhisperJson(raw: string): { language: string; segments: TranscriptSegment[] } {
  const parsed = JSON.parse(raw) as WhisperJson;
  const segments: TranscriptSegment[] = [];
  for (const entry of parsed.transcription ?? []) {
    const text = (entry.text ?? '').trim();
    if (!text) continue;
    segments.push({
      start: entry.offsets?.from ?? 0,
      end: entry.offsets?.to ?? entry.offsets?.from ?? 0,
      text,
    });
  }
  return { language: parsed.result?.language ?? 'unknown', segments };
}

export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * The Markdown copy is what an agent reads back. Timestamps lead each line so a
 * summary can cite a moment in the audio without a second lookup.
 */
export function toMarkdown(title: string, transcript: Transcript): string {
  const head = [
    `# ${title}`,
    '',
    `- language: ${transcript.language}`,
    `- model: ${path.basename(transcript.model)}`,
    `- transcribed: ${transcript.createdAt}`,
    '',
  ];
  const body = transcript.segments.map((s) => `\`${formatTimestamp(s.start)}\` ${s.text}`);
  return `${[...head, ...body].join('\n')}\n`;
}

export type TranscribeFileOptions = {
  audioPath: string;
  wavPath: string;
  config: TranscribeConfig;
  userCwd: string;
  language?: string;
  model?: string;
  /** Keep the intermediate 16 kHz WAV. Defaults to false. */
  keepWav?: boolean;
};

export class WhisperUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WhisperUnavailableError';
  }
}

export async function transcribeFile(opts: TranscribeFileOptions): Promise<Transcript> {
  const startedAt = Date.now();
  const ffmpeg = await which(opts.config.ffmpeg ?? 'ffmpeg');
  if (!ffmpeg) {
    throw new WhisperUnavailableError('ffmpeg not found — install it with `brew install ffmpeg`');
  }
  const bin = await resolveBin(opts.config);
  if (!bin) {
    throw new WhisperUnavailableError(
      'whisper.cpp not found — install it with `brew install whisper-cpp`, or set transcribe.bin in open-recording.config.ts',
    );
  }
  const model = opts.model
    ? await resolveModel({ ...opts.config, model: opts.model }, opts.userCwd)
    : await resolveModel(opts.config, opts.userCwd);
  if (!model) {
    throw new WhisperUnavailableError(
      `no whisper model found — download one into ${modelSearchDirs(opts.userCwd)[0]}, e.g. ggml-large-v3-turbo.bin, or set transcribe.model in open-recording.config.ts`,
    );
  }

  await toWhisperWav(ffmpeg, opts.audioPath, opts.wavPath);

  const prefix = opts.wavPath.replace(/\.wav$/, '');
  const language = opts.language ?? opts.config.language ?? 'auto';
  const args = [
    '-m',
    model,
    '-f',
    opts.wavPath,
    '-l',
    language,
    '-oj',
    '-of',
    prefix,
    '-np',
    ...(opts.config.threads ? ['-t', String(opts.config.threads)] : []),
    ...(opts.config.extraArgs ?? []),
  ];
  const result = await run(bin, args);
  if (result.code !== 0) {
    throw new Error(
      `whisper failed (${result.code}): ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }

  const jsonPath = `${prefix}.json`;
  const raw = await readFile(jsonPath, 'utf8');
  const { language: detected, segments } = parseWhisperJson(raw);
  await unlink(jsonPath).catch(() => {});
  if (!opts.keepWav) await unlink(opts.wavPath).catch(() => {});

  return {
    model,
    language: detected,
    createdAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
    text: segments.map((s) => s.text).join('\n'),
    segments,
  };
}
