import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import {
  AUDIO_FILE,
  deleteRecordingDir,
  listRecordingIds,
  NOTES_FILE,
  patchMeta,
  type RecordingMeta,
  readMeta,
  readTranscriptFile,
  recordingFile,
  TRANSCRIPT_MD_FILE,
  type Transcript,
} from '../files/store.ts';
import { type ApiContext, OpsError } from './context.ts';

export type RecordingSummary = Pick<
  RecordingMeta,
  'id' | 'title' | 'status' | 'createdAt' | 'durationMs' | 'sizeBytes' | 'tags' | 'source'
> & {
  transcribed: boolean;
  hasNotes: boolean;
  /** Opening words of the transcript, so a card can show what was said. */
  preview: string | null;
};

function summarize(meta: RecordingMeta, ctx: ApiContext, preview: string | null): RecordingSummary {
  const notes = recordingFile(ctx, meta.id, NOTES_FILE);
  return {
    id: meta.id,
    title: meta.title,
    status: meta.status,
    createdAt: meta.createdAt,
    durationMs: meta.durationMs,
    sizeBytes: meta.sizeBytes,
    tags: meta.tags,
    source: meta.source,
    transcribed: Boolean(meta.transcript),
    hasNotes: Boolean(notes && existsSync(notes)),
    preview,
  };
}

const PREVIEW_CHARS = 220;

export async function listRecordings(ctx: ApiContext): Promise<RecordingSummary[]> {
  const ids = await listRecordingIds(ctx);
  const out: RecordingSummary[] = [];
  for (const id of ids) {
    const meta = await readMeta(ctx, id);
    if (!meta) continue;
    const transcript = meta.transcript ? await readTranscriptFile(ctx, id) : null;
    const preview = transcript?.text.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_CHARS) ?? null;
    out.push(summarize(meta, ctx, preview || null));
  }
  return out;
}

export async function readRecording(ctx: ApiContext, id: string): Promise<RecordingMeta> {
  const meta = await readMeta(ctx, id);
  if (!meta) throw new OpsError(404, `recording not found: ${id}`);
  return meta;
}

export function audioPath(ctx: ApiContext, id: string): string {
  const file = recordingFile(ctx, id, AUDIO_FILE);
  if (!file) throw new OpsError(400, `invalid recording id: ${id}`);
  if (!existsSync(file)) throw new OpsError(404, `no audio for recording: ${id}`);
  return file;
}

export type TranscriptView = 'text' | 'markdown' | 'segments';

export async function readTranscript(
  ctx: ApiContext,
  id: string,
  view: TranscriptView = 'markdown',
): Promise<string | Transcript> {
  await readRecording(ctx, id);
  if (view === 'markdown') {
    const file = recordingFile(ctx, id, TRANSCRIPT_MD_FILE);
    if (!file || !existsSync(file)) {
      throw new OpsError(404, `not transcribed yet: ${id} — call transcribe_recording first`);
    }
    return await readFile(file, 'utf8');
  }
  const transcript = await readTranscriptFile(ctx, id);
  if (!transcript) {
    throw new OpsError(404, `not transcribed yet: ${id} — call transcribe_recording first`);
  }
  return view === 'text' ? transcript.text : transcript;
}

export async function renameRecording(
  ctx: ApiContext,
  id: string,
  title: string,
): Promise<RecordingMeta> {
  const trimmed = title.trim();
  if (!trimmed) throw new OpsError(400, 'title must not be empty');
  await readRecording(ctx, id);
  const next = await patchMeta(ctx, id, { title: trimmed });
  if (!next) throw new OpsError(404, `recording not found: ${id}`);
  return next;
}

export async function tagRecording(
  ctx: ApiContext,
  id: string,
  tags: string[],
): Promise<RecordingMeta> {
  await readRecording(ctx, id);
  const next = await patchMeta(ctx, id, { tags: tags.map((t) => t.trim()).filter(Boolean) });
  if (!next) throw new OpsError(404, `recording not found: ${id}`);
  return next;
}

/** Where an agent parks a summary, action items, or anything else it derived from the audio. */
export async function writeNotes(
  ctx: ApiContext,
  id: string,
  notes: string,
): Promise<{ ok: true }> {
  await readRecording(ctx, id);
  const file = recordingFile(ctx, id, NOTES_FILE);
  if (!file) throw new OpsError(400, `invalid recording id: ${id}`);
  await writeFile(file, notes.endsWith('\n') ? notes : `${notes}\n`, 'utf8');
  return { ok: true };
}

export async function readNotes(ctx: ApiContext, id: string): Promise<string> {
  await readRecording(ctx, id);
  const file = recordingFile(ctx, id, NOTES_FILE);
  if (!file || !existsSync(file)) throw new OpsError(404, `no notes for recording: ${id}`);
  return await readFile(file, 'utf8');
}

export async function deleteRecording(ctx: ApiContext, id: string): Promise<{ ok: true }> {
  await readRecording(ctx, id);
  const removed = await deleteRecordingDir(ctx, id);
  if (!removed) throw new OpsError(404, `recording not found: ${id}`);
  return { ok: true };
}

export type TranscriptHit = {
  id: string;
  title: string;
  createdAt: string;
  /** Milliseconds into the recording, so a hit can be played back. */
  start: number;
  text: string;
};

/** Plain substring search over stored transcripts — no index, because the corpus is one person's recordings. */
export async function searchTranscripts(
  ctx: ApiContext,
  query: string,
  limit = 20,
): Promise<TranscriptHit[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) throw new OpsError(400, 'query must not be empty');

  const hits: TranscriptHit[] = [];
  for (const id of await listRecordingIds(ctx)) {
    const meta = await readMeta(ctx, id);
    if (!meta) continue;
    const transcript = await readTranscriptFile(ctx, id);
    if (!transcript) continue;
    for (const segment of transcript.segments) {
      if (!segment.text.toLowerCase().includes(needle)) continue;
      hits.push({
        id,
        title: meta.title,
        createdAt: meta.createdAt,
        start: segment.start,
        text: segment.text,
      });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}
