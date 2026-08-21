import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeContext } from './context.ts';
import { editTranscriptSegment } from './transcribe.ts';

const workspaces: string[] = [];

const TRANSCRIPT = {
  model: '/models/ggml-small.bin',
  language: 'zh',
  createdAt: '2026-08-21T00:00:00.000Z',
  elapsedMs: 900,
  text: '大家好我是Simon\nAI卷要如何實作',
  segments: [
    { start: 0, end: 5000, text: '大家好我是Simon' },
    { start: 5000, end: 9000, text: 'AI卷要如何實作' },
  ],
};

async function transcribed() {
  const dir = await mkdtemp(path.join(tmpdir(), 'open-recording-'));
  workspaces.push(dir);
  const ctx = makeContext({ userCwd: dir, coreVersion: '0.0.0' });
  const id = '20260821-000000-talk';
  const at = path.join(ctx.recordingsRoot, id);
  await mkdir(at, { recursive: true });
  await writeFile(
    path.join(at, 'meta.json'),
    JSON.stringify({ id, title: 'Talk', status: 'ready', tags: [], transcript: { chars: 1 } }),
  );
  await writeFile(path.join(at, 'transcript.json'), JSON.stringify(TRANSCRIPT));
  return { ctx, id, at };
}

const read = (at: string, name: string) => readFile(path.join(at, name), 'utf8');

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('editTranscriptSegment', () => {
  it('rewrites the line and everything derived from it', async () => {
    const { ctx, id, at } = await transcribed();

    const next = await editTranscriptSegment(ctx, id, 1, 'AI Agent 如何實作');

    expect(next.segments[1].text).toBe('AI Agent 如何實作');
    // A correction that reached the page but not the subtitles would be worse
    // than the mistake, so all four views are written together.
    expect(await read(at, 'transcript.md')).toContain('AI Agent 如何實作');
    expect(await read(at, 'transcript.srt')).toContain('AI Agent 如何實作');
    expect(await read(at, 'transcript.vtt')).toContain('AI Agent 如何實作');
    expect(JSON.parse(await read(at, 'transcript.json')).text).toContain('AI Agent 如何實作');
  });

  it('keeps the timings, which the correction has nothing to do with', async () => {
    const { ctx, id } = await transcribed();
    const next = await editTranscriptSegment(ctx, id, 0, 'Hello, I am Simon');
    expect(next.segments[0]).toMatchObject({ start: 0, end: 5000 });
    expect(next.segments[1].text).toBe('AI卷要如何實作');
  });

  it('refuses an index the transcript does not have', async () => {
    const { ctx, id } = await transcribed();
    await expect(editTranscriptSegment(ctx, id, 7, 'nope')).rejects.toThrow(/no segment 7/);
  });

  it('refuses to empty a line rather than writing a blank cue', async () => {
    const { ctx, id } = await transcribed();
    await expect(editTranscriptSegment(ctx, id, 0, '   ')).rejects.toThrow(/cannot be emptied/);
  });

  it('refuses when there is no transcript to correct', async () => {
    const { ctx } = await transcribed();
    await expect(editTranscriptSegment(ctx, 'nope', 0, 'x')).rejects.toThrow(/not found/);
  });
});
