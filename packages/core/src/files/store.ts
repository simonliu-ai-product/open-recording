import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const RECORDING_ID_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

export type RecordingStatus = 'recording' | 'ready' | 'failed';

/** What was captured: a microphone, or a browser tab with its picture. */
export type RecordingKind = 'audio' | 'screen';

export type TranscriptSegment = {
  /** Milliseconds from the start of the recording. */
  start: number;
  end: number;
  text: string;
};

export type Transcript = {
  model: string;
  language: string;
  createdAt: string;
  /** How long the transcription itself took, not the audio length. */
  elapsedMs: number;
  text: string;
  segments: TranscriptSegment[];
};

export type RecordingMeta = {
  id: string;
  title: string;
  status: RecordingStatus;
  createdAt: string;
  updatedAt: string;
  durationMs: number;
  sizeBytes: number;
  mimeType: string;
  kind: RecordingKind;
  /** Name of the captured file inside the recording's directory. */
  file: string;
  tags: string[];
  /** Set while whisper is working on it, so the list can say so. */
  transcribing?: boolean;
  /** Whether the container carries a timeline a player can scrub. */
  seekable?: boolean;
  /** Who pressed record — an agent tool call or a person in the studio UI. */
  source: 'agent' | 'studio';
  note?: string;
  error?: string;
  transcript?: Omit<Transcript, 'segments' | 'text'> & { segmentCount: number; chars: number };
};

export type RecordingRoots = { recordingsRoot: string };

/**
 * A recording id doubles as a directory name, so it is validated before it is
 * ever joined onto a path — and the join is checked afterwards too, because a
 * regex is the wrong place to reason about traversal.
 */
export function recordingDir(roots: RecordingRoots, id: string): string | null {
  if (!RECORDING_ID_RE.test(id)) return null;
  const dir = path.resolve(roots.recordingsRoot, id);
  if (dir !== roots.recordingsRoot && !dir.startsWith(roots.recordingsRoot + path.sep)) return null;
  return dir;
}

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize('NFKD')
    // Anything outside the id alphabet becomes a separator, including CJK —
    // a Chinese title yields an empty slug and falls back to the timestamp.
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug;
}

/** `20260819-141530` — sorts chronologically as a plain string, which is why ids lead with it. */
export function timestampId(now: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  );
}

export function newRecordingId(title: string, now: Date): string {
  const slug = slugify(title);
  const id = slug ? `${timestampId(now)}-${slug}` : timestampId(now);
  return id.slice(0, 81);
}

export const AUDIO_FILE = 'audio.webm';
export const SCREEN_FILE = 'screen.webm';

/**
 * The captured file for a recording. `meta.file` is authoritative — recordings
 * made before screens were captured have no such field and are audio.
 */
export function mediaFileName(meta: Pick<RecordingMeta, 'kind' | 'file'>): string {
  return meta.file ?? (meta.kind === 'screen' ? SCREEN_FILE : AUDIO_FILE);
}
export const WAV_FILE = 'audio.wav';
export const META_FILE = 'meta.json';
export const TRANSCRIPT_FILE = 'transcript.json';
export const TRANSCRIPT_MD_FILE = 'transcript.md';
export const SUBTITLE_SRT_FILE = 'transcript.srt';
export const SUBTITLE_VTT_FILE = 'transcript.vtt';
export const NOTES_FILE = 'notes.md';

export async function ensureRecordingsRoot(roots: RecordingRoots): Promise<void> {
  await mkdir(roots.recordingsRoot, { recursive: true });
}

export async function listRecordingIds(roots: RecordingRoots): Promise<string[]> {
  if (!existsSync(roots.recordingsRoot)) return [];
  const entries = await readdir(roots.recordingsRoot, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && RECORDING_ID_RE.test(e.name))
    .map((e) => e.name)
    .sort()
    .reverse();
}

export async function readMeta(roots: RecordingRoots, id: string): Promise<RecordingMeta | null> {
  const dir = recordingDir(roots, id);
  if (!dir) return null;
  try {
    return JSON.parse(await readFile(path.join(dir, META_FILE), 'utf8')) as RecordingMeta;
  } catch {
    return null;
  }
}

/** Written whole through a temp file — a half-written meta.json would orphan the audio beside it. */
export async function writeMeta(roots: RecordingRoots, meta: RecordingMeta): Promise<void> {
  const dir = recordingDir(roots, meta.id);
  if (!dir) throw new Error(`invalid recording id: ${meta.id}`);
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, META_FILE);
  const tmp = `${target}.tmp`;
  await writeFile(tmp, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  await rename(tmp, target);
}

export async function patchMeta(
  roots: RecordingRoots,
  id: string,
  patch: Partial<RecordingMeta>,
): Promise<RecordingMeta | null> {
  const current = await readMeta(roots, id);
  if (!current) return null;
  const next: RecordingMeta = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await writeMeta(roots, next);
  return next;
}

export function recordingFile(roots: RecordingRoots, id: string, name: string): string | null {
  const dir = recordingDir(roots, id);
  if (!dir) return null;
  return path.join(dir, name);
}

/**
 * Appends one MediaRecorder slice. Slices are concatenated in arrival order,
 * which reconstructs exactly the byte stream a single Blob would have held —
 * only the first slice carries the WebM header, so order is not negotiable.
 */
export async function appendChunk(
  roots: RecordingRoots,
  id: string,
  name: string,
  chunk: Buffer,
): Promise<number> {
  const file = recordingFile(roots, id, name);
  if (!file) throw new Error(`invalid recording id: ${id}`);
  await mkdir(path.dirname(file), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(file, { flags: 'a' });
    stream.on('error', reject);
    stream.end(chunk, () => resolve());
  });
  const info = await stat(file);
  return info.size;
}

export async function deleteRecordingDir(roots: RecordingRoots, id: string): Promise<boolean> {
  const dir = recordingDir(roots, id);
  if (!dir || !existsSync(dir)) return false;
  await rm(dir, { recursive: true, force: true });
  return true;
}

export async function readTranscriptFile(
  roots: RecordingRoots,
  id: string,
): Promise<Transcript | null> {
  const file = recordingFile(roots, id, TRANSCRIPT_FILE);
  if (!file) return null;
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Transcript;
  } catch {
    return null;
  }
}
