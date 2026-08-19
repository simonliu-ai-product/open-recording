import path from 'node:path';
import type { OpenRecordingConfig, TranscribeConfig } from '../config.ts';

export type ApiContext = {
  userCwd: string;
  recordingsDir: string;
  recordingsRoot: string;
  coreVersion: string;
  chunkMs: number;
  maxDurationMs: number;
  transcribe: TranscribeConfig;
};

export type ApiContextOptions = {
  userCwd: string;
  coreVersion: string;
  config?: OpenRecordingConfig;
};

export const DEFAULT_CHUNK_MS = 5_000;
export const DEFAULT_MAX_DURATION_MS = 2 * 60 * 60 * 1000;

export function makeContext(opts: ApiContextOptions): ApiContext {
  const config = opts.config ?? {};
  const userCwd = path.resolve(opts.userCwd);
  const recordingsDir = config.recordingsDir ?? 'recordings';
  return {
    userCwd,
    recordingsDir,
    recordingsRoot: path.resolve(userCwd, recordingsDir),
    coreVersion: opts.coreVersion,
    chunkMs: config.chunkMs ?? DEFAULT_CHUNK_MS,
    maxDurationMs: config.maxDurationMs ?? DEFAULT_MAX_DURATION_MS,
    transcribe: config.transcribe ?? {},
  };
}

/** A refusal a caller can act on. The status is what the transport should report. */
export class OpsError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'OpsError';
    this.status = status;
  }
}
