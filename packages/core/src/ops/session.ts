import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { probeDurationMs } from '../audio/ffmpeg.ts';
import {
  AUDIO_FILE,
  deleteRecordingDir,
  ensureRecordingsRoot,
  listRecordingIds,
  mediaFileName,
  newRecordingId,
  patchMeta,
  type RecordingMeta,
  readMeta,
  recordingFile,
  SCREEN_FILE,
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
/**
 * Closes the books on a recording whose session ended without anyone stopping
 * it — a studio tab closed mid-take. The bytes it captured are real, so the
 * file is finalized rather than discarded, and the workspace is usable again.
 */
export async function reapAbandoned(ctx: ApiContext): Promise<string[]> {
  const open = recorderHub(ctx.userCwd).snapshot().recordingId;
  const reaped: string[] = [];
  for (const id of await listRecordingIds(ctx)) {
    if (id === open) continue;
    const meta = await readMeta(ctx, id);
    if (meta?.status !== 'recording') continue;
    await finalize(ctx, id, recorderHub(ctx.userCwd).snapshot());
    reaped.push(id);
  }
  return reaped;
}

export async function startRecording(
  ctx: ApiContext,
  opts: StartRecordingOptions = {},
): Promise<RecordingMeta> {
  const hub = recorderHub(ctx.userCwd);
  await reapAbandoned(ctx);
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
    // Corrected from the studio's acknowledgement, which knows what it took.
    kind: 'audio',
    file: AUDIO_FILE,
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
  const kind = hub.snapshot().kind;
  const settled = await patchMeta(ctx, id, {
    kind,
    file: kind === 'screen' ? SCREEN_FILE : AUDIO_FILE,
    mimeType: kind === 'screen' ? 'video/webm' : 'audio/webm',
  });
  return settled ?? meta;
}

async function finalize(ctx: ApiContext, id: string, state: RecorderState): Promise<RecordingMeta> {
  const current = await readMeta(ctx, id);
  const file = recordingFile(ctx, id, current ? mediaFileName(current) : AUDIO_FILE);
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

  // A paused recorder stops from where it is; there is no need to resume first.
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

/** How long a studio gets to confirm a pause or a resume. */
const TOGGLE_TIMEOUT_MS = 10_000;

async function toggle(
  ctx: ApiContext,
  from: 'recording' | 'paused',
  to: 'paused' | 'recording',
): Promise<RecorderState> {
  const hub = recorderHub(ctx.userCwd);
  const state = hub.snapshot();
  if (state.status !== from) {
    throw new OpsError(
      409,
      state.status === to
        ? `already ${to}`
        : `cannot ${to === 'paused' ? 'pause' : 'resume'} while ${state.status}`,
    );
  }
  const sessionId = state.sessionId;

  if (to === 'paused') hub.requestPause();
  else hub.requestResume();

  try {
    await hub.waitFor((s) => s.status === to || s.sessionId !== sessionId, TOGGLE_TIMEOUT_MS);
  } catch {
    throw new OpsError(
      504,
      `the studio did not confirm the ${to === 'paused' ? 'pause' : 'resume'}`,
    );
  }
  return hub.snapshot();
}

/**
 * Pauses without closing the recording. The audio stays one file — the paused
 * span is simply absent from it — so a meeting interrupted halfway does not
 * become two recordings to reconcile afterwards.
 */
export async function pauseRecording(ctx: ApiContext): Promise<RecorderState> {
  return await toggle(ctx, 'recording', 'paused');
}

export async function resumeRecording(ctx: ApiContext): Promise<RecorderState> {
  return await toggle(ctx, 'paused', 'recording');
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
