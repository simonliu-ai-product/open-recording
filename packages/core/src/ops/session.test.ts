import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeContext } from './context.ts';
import { reapAbandoned } from './session.ts';

const workspaces: string[] = [];

async function workspace(): Promise<ReturnType<typeof makeContext>> {
  const dir = await mkdtemp(path.join(tmpdir(), 'open-recording-'));
  workspaces.push(dir);
  return makeContext({ userCwd: dir, coreVersion: '0.0.0' });
}

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function plant(
  ctx: ReturnType<typeof makeContext>,
  id: string,
  meta: Record<string, unknown>,
  bytes: number,
) {
  const dir = path.join(ctx.recordingsRoot, id);
  await writeFile(path.join(dir, 'audio.webm'), Buffer.alloc(bytes), { flag: 'w' }).catch(
    async () => {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'audio.webm'), Buffer.alloc(bytes));
    },
  );
  await writeFile(path.join(dir, 'meta.json'), JSON.stringify({ id, ...meta }));
}

const base = {
  title: 'Left open',
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z',
  durationMs: 0,
  sizeBytes: 0,
  mimeType: 'audio/webm',
  tags: [],
  source: 'studio',
  kind: 'audio',
  file: 'audio.webm',
};

describe('reapAbandoned', () => {
  it('finalizes a recording whose session ended without a stop', async () => {
    const ctx = await workspace();
    await plant(ctx, '20260821-000000-left-open', { ...base, status: 'recording' }, 4096);

    expect(await reapAbandoned(ctx)).toEqual(['20260821-000000-left-open']);

    const meta = JSON.parse(
      await readFile(
        path.join(ctx.recordingsRoot, '20260821-000000-left-open', 'meta.json'),
        'utf8',
      ),
    );
    // The bytes it captured are real, so the file is kept rather than discarded.
    expect(meta.status).toBe('ready');
    expect(meta.sizeBytes).toBe(4096);
  });

  it('marks one that captured nothing as failed, and says why', async () => {
    const ctx = await workspace();
    await plant(ctx, '20260821-000001-silent', { ...base, status: 'recording' }, 0);

    await reapAbandoned(ctx);

    const meta = JSON.parse(
      await readFile(path.join(ctx.recordingsRoot, '20260821-000001-silent', 'meta.json'), 'utf8'),
    );
    expect(meta.status).toBe('failed');
    expect(meta.error).toBeTruthy();
  });

  it('leaves finished recordings alone', async () => {
    const ctx = await workspace();
    await plant(ctx, '20260821-000002-done', { ...base, status: 'ready', sizeBytes: 10 }, 10);

    expect(await reapAbandoned(ctx)).toEqual([]);
  });
});
