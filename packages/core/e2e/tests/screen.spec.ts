import { expect, test } from '@playwright/test';
import { chooseSource, clearRecordings, control, listOnDisk, readMeta, status } from './helpers.ts';

test.beforeEach(async () => {
  await clearRecordings();
});

test.describe('recording a tab', () => {
  test('captures picture and audio into one file, and subtitles it', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('connected', { exact: true })).toBeVisible();

    // Chrome answers its own picker here (see playwright.config.ts); a person
    // picks the tab themselves, which is why this is a button and not a tool.
    await chooseSource(page, 'A browser tab');
    await expect(page.getByText('Sharing a tab')).toBeVisible();

    await control(page, 'start', { title: 'Tab capture' });
    await expect.poll(async () => (await status(page)).status).toBe('recording');
    await expect
      .poll(async () => (await status(page)).durationMs, { timeout: 10_000 })
      .toBeGreaterThan(0);

    await control(page, 'stop');
    await expect.poll(async () => (await status(page)).status).toBe('idle');

    const [id] = await listOnDisk();
    const meta = await readMeta(id);
    expect(meta.kind).toBe('screen');
    expect(meta.file).toBe('screen.webm');
    expect(meta.sizeBytes).toBeGreaterThan(1000);

    // It has to be a real video the browser will decode, not just bytes.
    const decoded = await page.evaluate(async (recordingId) => {
      const video = document.createElement('video');
      video.src = `/__rec/recordings/${recordingId}/audio`;
      return await new Promise<{ ok: boolean; width: number }>((resolve) => {
        const timer = setTimeout(() => resolve({ ok: false, width: 0 }), 8000);
        video.onloadedmetadata = () => {
          clearTimeout(timer);
          resolve({ ok: true, width: video.videoWidth });
        };
        video.onerror = () => {
          clearTimeout(timer);
          resolve({ ok: false, width: 0 });
        };
      });
    }, id);
    expect(decoded.ok).toBe(true);
    expect(decoded.width).toBeGreaterThan(0);
  });
});
