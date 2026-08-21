import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import {
  deleteRecordingDir,
  listRecordingIds,
  mediaFileName,
  NOTES_FILE,
  patchMeta,
  type RecordingMeta,
  readMeta,
  readTranscriptFile,
  recordingFile,
  SUBTITLE_SRT_FILE,
  SUBTITLE_VTT_FILE,
  TRANSCRIPT_FILE,
  TRANSCRIPT_MD_FILE,
  type Transcript,
} from '../files/store.ts';
import { type ApiContext, OpsError } from './context.ts';

export type RecordingSummary = Pick<
  RecordingMeta,
  'id' | 'title' | 'status' | 'createdAt' | 'durationMs' | 'sizeBytes' | 'tags' | 'source' | 'kind'
> & {
  transcribed: boolean;
  transcribing: boolean;
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
    kind: meta.kind ?? 'audio',
    transcribed: Boolean(meta.transcript),
    transcribing: Boolean(meta.transcribing),
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

export async function mediaPath(ctx: ApiContext, id: string): Promise<string> {
  const meta = await readRecording(ctx, id);
  const file = recordingFile(ctx, id, mediaFileName(meta));
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

export type DownloadKind = 'media' | 'transcript' | 'srt' | 'vtt' | 'segments';

export type Download = {
  path: string;
  /** What the file should be called once it is somewhere else. */
  filename: string;
  contentType: string;
};

const DOWNLOADS: Record<DownloadKind, { file: string | null; type: string; suffix: string }> = {
  media: { file: null, type: 'application/octet-stream', suffix: '' },
  transcript: { file: TRANSCRIPT_MD_FILE, type: 'text/markdown; charset=utf-8', suffix: '.md' },
  srt: { file: SUBTITLE_SRT_FILE, type: 'application/x-subrip; charset=utf-8', suffix: '.srt' },
  vtt: { file: SUBTITLE_VTT_FILE, type: 'text/vtt; charset=utf-8', suffix: '.vtt' },
  segments: { file: TRANSCRIPT_FILE, type: 'application/json; charset=utf-8', suffix: '.json' },
};

/**
 * A recording is a directory on the user's disk, which is no use to them once
 * they want the subtitles in an editor. Every artefact is named after the
 * recording rather than after its slot in that directory, so five downloads
 * do not all arrive called `transcript`.
 */
export async function downloadPath(
  ctx: ApiContext,
  id: string,
  kind: DownloadKind,
): Promise<Download> {
  const meta = await readRecording(ctx, id);
  const spec = DOWNLOADS[kind];
  const name = spec.file ?? mediaFileName(meta);
  const file = recordingFile(ctx, id, name);
  if (!file || !existsSync(file)) {
    throw new OpsError(
      404,
      kind === 'media' ? `no audio for recording: ${id}` : `not transcribed yet: ${id}`,
    );
  }
  return {
    path: file,
    filename: spec.file
      ? `${id}${spec.suffix}`
      : `${id}${meta.kind === 'screen' ? '.webm' : '.webm'}`,
    contentType: spec.file ? spec.type : meta.kind === 'screen' ? 'video/webm' : 'audio/webm',
  };
}

/** The stored cues, in the format a player or an editor asked for. */
export async function readSubtitles(
  ctx: ApiContext,
  id: string,
  format: 'srt' | 'vtt',
): Promise<string> {
  await readRecording(ctx, id);
  const file = recordingFile(ctx, id, format === 'srt' ? SUBTITLE_SRT_FILE : SUBTITLE_VTT_FILE);
  if (!file || !existsSync(file)) {
    throw new OpsError(404, `no subtitles for: ${id} — transcribe it first`);
  }
  return await readFile(file, 'utf8');
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
