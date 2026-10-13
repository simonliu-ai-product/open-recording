import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ApiContext } from './context.ts';

export type CurrentRecordingState = {
  recordingId: string | null;
  title?: string;
  currentTimeMs?: number;
  updatedAt: string;
};

function currentFilePath(ctx: ApiContext): string {
  return path.join(ctx.userCwd, 'node_modules', '.open-recording', 'current.json');
}

export async function readCurrent(ctx: ApiContext): Promise<CurrentRecordingState> {
  const file = currentFilePath(ctx);
  if (!existsSync(file)) {
    return { recordingId: null, updatedAt: new Date(0).toISOString() };
  }
  try {
    return JSON.parse(await readFile(file, 'utf8')) as CurrentRecordingState;
  } catch {
    return { recordingId: null, updatedAt: new Date(0).toISOString() };
  }
}

export async function writeCurrent(
  ctx: ApiContext,
  input: { recordingId: string | null; title?: string; currentTimeMs?: number },
): Promise<CurrentRecordingState> {
  const next: CurrentRecordingState = {
    recordingId: input.recordingId,
    ...(input.title ? { title: input.title } : {}),
    ...(typeof input.currentTimeMs === 'number'
      ? { currentTimeMs: Math.round(input.currentTimeMs) }
      : {}),
    updatedAt: new Date().toISOString(),
  };
  const file = currentFilePath(ctx);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}
