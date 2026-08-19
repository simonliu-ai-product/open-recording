import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { probeDurationMs } from '../audio/ffmpeg.ts';
import {
  AUDIO_FILE,
  deleteRecordingDir,
  ensureRecordingsRoot,
  newRecordingId,
  patchMeta,
  type RecordingMeta,
  readMeta,
  recordingFile,
  writeMeta,
} from '../files/store.ts';
import { type RecorderState, recorderHub } from '../recorder/hub.ts';
import { type ApiContext, OpsError } from './context.ts';

/** How long a studio gets to open a microphone before the start is refused. */
const ARM_TIMEOUT_MS = 15_000;
/** How long a studio gets to flush its last slice after a stop. */
const STOP_TIMEOUT_MS = 30_000;

export type StartRecordingOptions = {
  title?: string;
  tags?: string[];
  note?: string;
  source?: 'agent' | 'studio';
};

export type RecorderSnapshot = RecorderState & {
  /** Present once a session has produced a file worth naming. */
  recording?: RecordingMeta | null;
};

export function recorderStatus(ctx: ApiContext): RecorderState {
  return recorderHub(ctx.userCwd).snapshot();
}

/**
 * Presses record. The audio itself is captured by a studio page in a real
 * browser — this only opens the session and waits for that page to confirm its
 * MediaRecorder is running, so a caller never gets an "ok" for a recording that
 * is not actually being made.
 */
export async function startRecording(
  ctx: ApiContext,
  opts: StartRecordingOptions = {},
): Promise<RecordingMeta> {
  const hub = recorderHub(ctx.userCwd);
  const state = hub.snapshot();
  if (state.status !== 'idle') {
    throw new OpsError(
      409,
      `already ${state.status} (${state.recordingId ?? 'no id'}) — stop it first`,
    );
  }
  if (hub.studioCount() === 0) {
    throw new OpsError(
      503,
      'no studio connected — open the open-recording dev server in a browser and allow microphone access',
    );
  }

  const now = new Date();
  const title = opts.title?.trim() || `Recording ${now.toLocaleString()}`;
  await ensureRecordingsRoot(ctx);

  let id = newRecordingId(title, now);
  let suffix = 2;
  while (existsSync(path.join(ctx.recordingsRoot, id))) {
    id = `${newRecordingId(title, now)}-${suffix}`.slice(0, 81);
    suffix += 1;
  }

  const meta: RecordingMeta = {
    id,
    title,
    status: 'recording',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    durationMs: 0,
    sizeBytes: 0,
    mimeType: 'audio/webm',
    tags: opts.tags?.map((t) => t.trim()).filter(Boolean) ?? [],
    source: opts.source ?? 'agent',
    ...(opts.note ? { note: opts.note } : {}),
  };
  await writeMeta(ctx, meta);

  const sessionId = hub.nextSessionId(now);
  hub.arm({
    sessionId,
    recordingId: id,
    title,
    chunkMs: ctx.chunkMs,
    maxDurationMs: ctx.maxDurationMs,
  });

  try {
    await hub.waitFor((s) => s.status === 'recording' || s.sessionId !== sessionId, ARM_TIMEOUT_MS);
  } catch {
    hub.abandon(sessionId, 'studio did not start');
    await deleteRecordingDir(ctx, id);
    throw new OpsError(
      504,
      'the studio did not start recording — the page may be closed, backgrounded, or missing microphone permission',
    );
  }

  const after = hub.snapshot();
  if (after.sessionId !== sessionId) {
    await deleteRecordingDir(ctx, id);
    throw new OpsError(500, after.error ?? 'recording failed to start');
  }
  return (await readMeta(ctx, id)) ?? meta;
}

async function finalize(ctx: ApiContext, id: string, state: RecorderState): Promise<RecordingMeta> {
  const file = recordingFile(ctx, id, AUDIO_FILE);
  const sizeBytes = file && existsSync(file) ? (await stat(file)).size : 0;
  const probed =
    file && sizeBytes > 0 ? await probeDurationMs(ctx.transcribe.ffmpeg ?? 'ffmpeg', file) : null;

  const meta = await patchMeta(ctx, id, {
    status: sizeBytes > 0 ? 'ready' : 'failed',
    sizeBytes,
    durationMs: probed ?? state.durationMs,
    ...(sizeBytes > 0 ? {} : { error: state.error ?? 'no audio was captured' }),
  });
  if (!meta) throw new OpsError(404, `recording not found: ${id}`);
  return meta;
}

/** Stops the open session and waits for the studio's final slice to land on disk. */
export async function stopRecording(ctx: ApiContext): Promise<RecordingMeta> {
  const hub = recorderHub(ctx.userCwd);
  const state = hub.snapshot();
  if (state.status === 'idle' || !state.recordingId) {
    throw new OpsError(409, 'nothing is being recorded');
  }
  const id = state.recordingId;
  const sessionId = state.sessionId;

  hub.requestStop();
  try {
    await hub.waitFor((s) => s.sessionId === null || s.sessionId !== sessionId, STOP_TIMEOUT_MS);
  } catch {
    // The studio went quiet. Whatever it already uploaded is still a recording,
    // so the session is closed here rather than left open forever.
    if (sessionId) hub.abandon(sessionId, 'studio did not confirm the stop');
  }

  return await finalize(ctx, id, hub.snapshot());
}

/** Stops the open session and throws the audio away. */
export async function cancelRecording(ctx: ApiContext): Promise<{ ok: true; discarded: string }> {
  const hub = recorderHub(ctx.userCwd);
  const state = hub.snapshot();
  if (state.status === 'idle' || !state.recordingId) {
    throw new OpsError(409, 'nothing is being recorded');
  }
  const id = state.recordingId;
  const sessionId = state.sessionId;

  hub.requestCancel();
  try {
    await hub.waitFor((s) => s.sessionId === null || s.sessionId !== sessionId, STOP_TIMEOUT_MS);
  } catch {
    if (sessionId) hub.abandon(sessionId, 'studio did not confirm the cancel');
  }
  await deleteRecordingDir(ctx, id);
  return { ok: true, discarded: id };
}
