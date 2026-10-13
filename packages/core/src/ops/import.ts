import { existsSync } from 'node:fs';
import { copyFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { probeDurationMs, remuxSeekable, transcodeToWebm } from '../audio/ffmpeg.ts';
import {
  AUDIO_FILE,
  ensureRecordingsRoot,
  NOTES_FILE,
  newRecordingId,
  type RecordingKind,
  type RecordingMeta,
  readMeta,
  recordingFile,
  SCREEN_FILE,
  writeMeta,
} from '../files/store.ts';
import { type ApiContext, OpsError } from './context.ts';
import { transcribeRecording } from './transcribe.ts';

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.m4v']);

export type ImportRecordingOptions = {
  /** Path on disk (for CLI / MCP). */
  filePath?: string;
  /** Raw bytes uploaded from the browser. */
  bytes?: Buffer;
  /** Original filename when uploading raw bytes. */
  filename?: string;
  title?: string;
  tags?: string[];
  note?: string;
  source?: 'agent' | 'studio';
  transcribe?: boolean;
  language?: string;
};

function inferTitle(filename: string): string {
  const base = path.basename(filename, path.extname(filename));
  return base.replace(/[-_]+/g, ' ').trim() || 'Imported recording';
}

export async function importRecording(
  ctx: ApiContext,
  opts: ImportRecordingOptions,
): Promise<RecordingMeta> {
  if (!opts.filePath && (!opts.bytes || opts.bytes.length === 0)) {
    throw new OpsError(400, 'either filePath or bytes must be provided');
  }

  let absSource: string | null = null;
  if (opts.filePath) {
    absSource = path.isAbsolute(opts.filePath)
      ? opts.filePath
      : path.resolve(ctx.userCwd, opts.filePath);
    if (!existsSync(absSource)) {
      throw new OpsError(404, `file not found: ${opts.filePath}`);
    }
  }

  const originName = opts.filename ?? (absSource ? path.basename(absSource) : 'import.webm');
  const ext = path.extname(originName).toLowerCase();
  const kind: RecordingKind = VIDEO_EXTS.has(ext) ? 'screen' : 'audio';
  const targetFile = kind === 'screen' ? SCREEN_FILE : AUDIO_FILE;

  const now = new Date();
  const title = opts.title?.trim() || inferTitle(originName);
  await ensureRecordingsRoot(ctx);

  let id = newRecordingId(title, now);
  let suffix = 2;
  while (existsSync(path.join(ctx.recordingsRoot, id))) {
    id = `${newRecordingId(title, now)}-${suffix}`.slice(0, 81);
    suffix += 1;
  }

  const initial: RecordingMeta = {
    id,
    title,
    status: 'ready',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    durationMs: 0,
    sizeBytes: 0,
    mimeType: kind === 'screen' ? 'video/webm' : 'audio/webm',
    kind,
    file: targetFile,
    tags: opts.tags?.map((t) => t.trim()).filter(Boolean) ?? [],
    source: opts.source ?? 'studio',
    ...(opts.note ? { note: opts.note } : {}),
  };
  await writeMeta(ctx, initial);

  const dest = recordingFile(ctx, id, targetFile);
  if (!dest) throw new OpsError(400, `invalid recording id: ${id}`);

  const ffmpeg = ctx.transcribe.ffmpeg ?? 'ffmpeg';
  const tempInput = recordingFile(ctx, id, `import-source${ext || '.bin'}`);
  if (!tempInput) throw new OpsError(400, `invalid recording id: ${id}`);

  try {
    if (absSource) {
      await copyFile(absSource, tempInput);
    } else if (opts.bytes) {
      await writeFile(tempInput, opts.bytes);
    }

    if (ext === '.webm') {
      await copyFile(tempInput, dest);
      await remuxSeekable(ffmpeg, dest);
    } else {
      const converted = await transcodeToWebm(ffmpeg, tempInput, dest, kind);
      if (!converted) {
        // Fallback: keep raw media if ffmpeg isn't installed so the user still has the file.
        await copyFile(tempInput, dest);
      } else {
        await remuxSeekable(ffmpeg, dest);
      }
    }
  } finally {
    await unlink(tempInput).catch(() => {});
  }

  const sizeBytes = existsSync(dest) ? (await stat(dest)).size : 0;
  const durationMs = (await probeDurationMs(ffmpeg, dest)) ?? 0;

  if (opts.note) {
    const notesPath = recordingFile(ctx, id, NOTES_FILE);
    if (notesPath) {
      await writeFile(notesPath, opts.note.endsWith('\n') ? opts.note : `${opts.note}\n`, 'utf8');
    }
  }

  const finalMeta: RecordingMeta = {
    ...initial,
    updatedAt: new Date().toISOString(),
    sizeBytes,
    durationMs,
    seekable: durationMs > 0,
  };
  await writeMeta(ctx, finalMeta);

  if (opts.transcribe) {
    await transcribeRecording(ctx, id, {
      ...(opts.language ? { language: opts.language } : {}),
    });
    const refreshed = await readMeta(ctx, id);
    return refreshed ?? finalMeta;
  }

  return finalMeta;
}
