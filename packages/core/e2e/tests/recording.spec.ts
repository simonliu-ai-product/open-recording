import { expect, test } from '@playwright/test';
import {
  armedStudio,
  audioSize,
  clearRecordings,
  control,
  listOnDisk,
  readMeta,
  status,
} from './helpers.ts';

test.beforeEach(async () => {
  await clearRecordings();
});

test.describe('the studio records', () => {
  test('press record, press stop, and the audio is on disk', async ({ page }) => {
    await armedStudio(page);

    await page.getByPlaceholder('Title (optional)').fill('Fixture session');
    await page.getByRole('button', { name: 'Start recording' }).click();

    // The button only becomes Stop once the studio has acknowledged that
    // MediaRecorder is running — that is the whole contract of `start`.
    await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible();
    expect((await status(page)).status).toBe('recording');

    await expect.poll(async () => (await status(page)).durationMs).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Stop recording' }).click();

    await expect.poll(async () => (await status(page)).status).toBe('idle');

    const [id] = await listOnDisk();
    expect(id).toBeTruthy();
    const meta = await readMeta(id);
    expect(meta.title).toBe('Fixture session');
    expect(meta.status).toBe('ready');
    // Real Opus from the fake device, not an empty file.
    expect(await audioSize(id)).toBeGreaterThan(1000);
    expect(meta.durationMs).toBeGreaterThan(0);
  });

  test('an agent can drive the recorder the studio is holding', async ({ page }) => {
    await armedStudio(page);

    const started = (await control(page, 'start', { title: 'Agent driven' })) as {
      status: number;
      body: { id: string; source: string };
    };
    expect(started.status).toBe(200);
    expect(started.body.source).toBe('studio');

    // The page follows a session it did not begin.
    await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible();
    await expect(page.getByText('Agent driven ·')).toBeVisible();

    await expect.poll(async () => (await status(page)).durationMs).toBeGreaterThan(0);
    await control(page, 'stop');
    await expect.poll(async () => (await status(page)).status).toBe('idle');

    expect(await audioSize(started.body.id)).toBeGreaterThan(1000);
  });

  test('a second recording is refused while one is open', async ({ page }) => {
    await armedStudio(page);
    await control(page, 'start', { title: 'First' });
    await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible();

    const second = (await control(page, 'start', { title: 'Second' })) as {
      status: number;
      body: { error: string };
    };
    expect(second.status).toBe(409);
    expect(second.body.error).toContain('already recording');

    await control(page, 'stop');
    await expect.poll(async () => (await listOnDisk()).length).toBe(1);
  });

  test('discarding leaves nothing behind', async ({ page }) => {
    await armedStudio(page);
    await page.getByRole('button', { name: 'Start recording' }).click();
    await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible();

    await page.getByRole('button', { name: 'Discard' }).click();
    await expect.poll(async () => (await status(page)).status).toBe('idle');
    expect(await listOnDisk()).toEqual([]);
  });

  test('starting without a studio is refused, and says why', async ({ request }) => {
    // No page is open, so nothing in this workspace holds a microphone.
    const res = await request.post('/__rec/start', { data: { title: 'Nobody' } });
    expect(res.status()).toBe(503);
    expect((await res.json()).error).toContain('no studio connected');
    expect(await listOnDisk()).toEqual([]);
  });
});
