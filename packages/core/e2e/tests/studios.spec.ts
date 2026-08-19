import { expect, test } from '@playwright/test';
import { armedStudio, audioSize, clearRecordings, control, listOnDisk, status } from './helpers.ts';

test.beforeEach(async () => {
  await clearRecordings();
});

test.describe('more than one studio page', () => {
  test('only one page records, however many are open', async ({ page, context }) => {
    await armedStudio(page);
    const second = await context.newPage();
    await armedStudio(second);
    await expect.poll(async () => (await status(page)).studios).toBe(2);

    await control(page, 'start', { title: 'Two tabs' });
    await expect.poll(async () => (await status(page)).status).toBe('recording');
    await expect.poll(async () => (await status(page)).durationMs).toBeGreaterThan(600);

    await control(page, 'stop');
    await expect.poll(async () => (await status(page)).status).toBe('idle');

    // Two microphones appending to one file would interleave two WebM streams
    // and the result would not decode; a single owner is what keeps it playable.
    const [id] = await listOnDisk();
    const bytes = await audioSize(id);
    const decoded = await page.evaluate(async (recordingId) => {
      const res = await fetch(`/__rec/recordings/${recordingId}/audio`);
      const buffer = await res.arrayBuffer();
      const context = new AudioContext();
      try {
        const audio = await context.decodeAudioData(buffer);
        return { ok: true, seconds: audio.duration };
      } catch (err) {
        return { ok: false, error: String(err) };
      } finally {
        await context.close();
      }
    }, id);

    expect(bytes).toBeGreaterThan(1000);
    expect(decoded).toMatchObject({ ok: true });
  });

  test('a tab left open in the background does not steal the recording', async ({
    page,
    context,
  }) => {
    // The stale tab: armed a while ago, then forgotten. Permission is
    // remembered per origin, so it can still take a microphone silently.
    const stale = await context.newPage();
    await armedStudio(stale);

    // The tab in front of the person, armed just now.
    await armedStudio(page);
    await expect.poll(async () => (await status(page)).studios).toBe(2);

    await control(page, 'start', { title: 'Fresh tab wins' });
    await expect.poll(async () => (await status(page)).status).toBe('recording');

    // Audio has to actually arrive: the freshest studio is the one recording,
    // and a session nobody feeds is exactly the failure this guards.
    await expect
      .poll(async () => (await status(page)).durationMs, { timeout: 10_000 })
      .toBeGreaterThan(0);

    await control(page, 'stop');
    await expect.poll(async () => (await status(page)).status).toBe('idle');

    const [id] = await listOnDisk();
    expect(await audioSize(id)).toBeGreaterThan(1000);
    await stale.close();
  });

  test('every open page shows the same recorder', async ({ page, context }) => {
    await armedStudio(page);
    const watcher = await context.newPage();
    await watcher.goto('/');
    await expect(watcher.getByText('connected', { exact: true })).toBeVisible();

    await control(page, 'start', { title: 'Shared state' });

    // The second page never pressed anything, and still follows the session.
    await expect(watcher.getByRole('button', { name: 'Stop recording' })).toBeVisible();
    await expect(watcher.getByText('Shared state ·')).toBeVisible();

    await control(page, 'pause');
    await expect(watcher.getByText('Paused', { exact: true })).toBeVisible();

    // And it can drive it: whoever presses stop, the other one sees it.
    await watcher.getByRole('button', { name: 'Stop recording' }).click();
    await expect.poll(async () => (await status(page)).status).toBe('idle');
    await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible();
  });
});
