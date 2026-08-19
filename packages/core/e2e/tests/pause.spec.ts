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

test.describe('pausing', () => {
  test('pause and resume keep one recording, and one file', async ({ page }) => {
    await armedStudio(page);
    await page.getByRole('button', { name: 'Start recording' }).click();
    await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible();
    await expect.poll(async () => (await status(page)).durationMs).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByText('Paused', { exact: true })).toBeVisible();
    // The badge is a client-side echo; the recorder itself settles a moment
    // later, so this waits for the server rather than assuming the two are
    // simultaneous.
    await expect.poll(async () => (await status(page)).status).toBe('paused');

    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByText('Paused', { exact: true })).toBeHidden();
    await expect.poll(async () => (await status(page)).status).toBe('recording');

    await page.getByRole('button', { name: 'Stop recording' }).click();
    await expect.poll(async () => (await status(page)).status).toBe('idle');

    // One session throughout — a pause must not split the meeting in two.
    const ids = await listOnDisk();
    expect(ids).toHaveLength(1);
    expect(await audioSize(ids[0])).toBeGreaterThan(1000);
    expect((await readMeta(ids[0])).status).toBe('ready');
  });

  test('the clock does not run while the recorder is paused', async ({ page }) => {
    await armedStudio(page);
    await control(page, 'start', { title: 'Timed' });
    await expect.poll(async () => (await status(page)).durationMs).toBeGreaterThan(0);

    await control(page, 'pause');
    await expect.poll(async () => (await status(page)).status).toBe('paused');
    const atPause = (await status(page)).durationMs;

    // Sit paused for well over a slice; none of it is captured.
    await page.waitForTimeout(2000);
    expect((await status(page)).durationMs).toBe(atPause);

    await control(page, 'resume');
    await expect.poll(async () => (await status(page)).durationMs).toBeGreaterThan(atPause);

    await control(page, 'stop');
    await expect.poll(async () => (await status(page)).status).toBe('idle');

    const [id] = await listOnDisk();
    const meta = await readMeta(id);
    // The paused span is absent from the audio, so the measured length is the
    // captured length — nowhere near the wall-clock time the session was open.
    expect(meta.durationMs).toBeLessThan(2000);
  });

  test('pausing twice, or resuming while recording, is refused', async ({ page }) => {
    await armedStudio(page);
    await control(page, 'start', { title: 'Guards' });
    await expect.poll(async () => (await status(page)).status).toBe('recording');

    const resumeWhileRecording = (await control(page, 'resume')) as {
      status: number;
      body: { error: string };
    };
    expect(resumeWhileRecording.status).toBe(409);

    await control(page, 'pause');
    await expect.poll(async () => (await status(page)).status).toBe('paused');

    const pauseTwice = (await control(page, 'pause')) as {
      status: number;
      body: { error: string };
    };
    expect(pauseTwice.status).toBe(409);
    expect(pauseTwice.body.error).toContain('already paused');

    await control(page, 'stop');
    await expect.poll(async () => (await status(page)).status).toBe('idle');
  });

  test('stop works straight from paused, without resuming first', async ({ page }) => {
    await armedStudio(page);
    await control(page, 'start', { title: 'Stopped while paused' });
    await expect.poll(async () => (await status(page)).durationMs).toBeGreaterThan(0);

    await control(page, 'pause');
    await expect.poll(async () => (await status(page)).status).toBe('paused');

    await control(page, 'stop');
    await expect.poll(async () => (await status(page)).status).toBe('idle');

    const [id] = await listOnDisk();
    expect((await readMeta(id)).status).toBe('ready');
    expect(await audioSize(id)).toBeGreaterThan(1000);
  });
});
