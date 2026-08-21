import { expect, test } from '@playwright/test';
import {
  armedStudio,
  audioSize,
  clearRecordings,
  control,
  finalized,
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
    const meta = await finalized(id);
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

test.describe('the list', () => {
  test('shows the same recordings as cards or as a table', async ({ page }) => {
    await armedStudio(page);
    await control(page, 'start', { title: 'Listed', tags: ['team'] });
    await expect.poll(async () => (await status(page)).durationMs).toBeGreaterThan(0);
    await control(page, 'stop');
    await expect.poll(async () => (await status(page)).status).toBe('idle');

    // Cards first, which is the default.
    await expect(page.getByRole('link', { name: /Listed/ })).toBeVisible();
    expect(await page.locator('table').count()).toBe(0);

    await page.getByRole('button', { name: 'Show as a table' }).click();
    const row = page.locator('table tbody tr');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Listed');
    // A table earns its place by showing what a card only hints at.
    await expect(row).toContainText('team');
    await expect(page.locator('table thead')).toContainText('Length');

    // The choice survives a reload, because it is a preference, not a mode.
    await page.reload();
    await expect(page.locator('table tbody tr')).toHaveCount(1);

    await page.getByRole('button', { name: 'Show as cards' }).click();
    expect(await page.locator('table').count()).toBe(0);
  });
});

test.describe('tags', () => {
  test('can be added and removed from the page, not only by an agent', async ({ page }) => {
    await armedStudio(page);
    await control(page, 'start', { title: 'Taggable' });
    await expect.poll(async () => (await status(page)).durationMs).toBeGreaterThan(0);
    await control(page, 'stop');
    await expect.poll(async () => (await status(page)).status).toBe('idle');

    const [id] = await listOnDisk();
    await page.goto(`/r/${id}`);
    await expect(page.getByRole('heading', { name: 'Taggable' })).toBeVisible();

    await page.getByLabel('Add a tag').fill('research');
    await page.getByLabel('Add a tag').press('Enter');
    // On disk is what counts: the sidebar and the API read from there.
    await expect.poll(async () => (await readMeta(id)).tags).toEqual(['research']);

    await page.getByLabel('Add a tag').fill('q3');
    await page.getByLabel('Add a tag').press('Enter');
    await expect.poll(async () => (await readMeta(id)).tags).toEqual(['research', 'q3']);

    await page.getByRole('button', { name: 'Remove tag research' }).click();
    await expect.poll(async () => (await readMeta(id)).tags).toEqual(['q3']);

    // And the tag becomes a way to navigate, which is the point of having them.
    await page.goto('/');
    await expect(page.getByRole('button', { name: /q3/ })).toBeVisible();
  });
});

test.describe('sorting', () => {
  test('a table heading orders the list, and the dropdown agrees', async ({ page }) => {
    await armedStudio(page);
    for (const title of ['Beta', 'Alpha']) {
      await control(page, 'start', { title });
      await expect.poll(async () => (await status(page)).durationMs).toBeGreaterThan(0);
      await control(page, 'stop');
      await expect.poll(async () => (await status(page)).status).toBe('idle');
    }

    await page.goto('/');
    await page.getByRole('button', { name: 'Show as a table' }).click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(2);
    // Newest first by default: Alpha was recorded last.
    await expect(rows.first()).toContainText('Alpha');

    // Scoped to the table: once it is sorting by title, the dropdown button
    // reads "Title" too, and an unscoped locator would find both.
    const heading = page.locator('table thead').getByRole('button', { name: 'Title' });
    await heading.click();
    await expect(rows.first()).toContainText('Alpha');
    // The two controls are one state: the dropdown now says what the column did.
    await expect(page.getByRole('button', { name: 'Title', exact: true }).first()).toBeVisible();

    // A second click on the same column turns it around.
    await heading.click();
    await expect(rows.first()).toContainText('Beta');
    await expect(page.locator('table thead th', { hasText: 'Title' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });
});

test.describe('the finished file', () => {
  test('carries a timeline a player can scrub', async ({ page }) => {
    await armedStudio(page);
    await control(page, 'start', { title: 'Scrubbable' });
    await expect.poll(async () => (await status(page)).durationMs).toBeGreaterThan(0);
    await page.waitForTimeout(1200);
    await control(page, 'stop');
    await expect.poll(async () => (await status(page)).status).toBe('idle');

    const [id] = await listOnDisk();
    // MediaRecorder writes a live stream with no duration and no index of where
    // the clusters are; finalizing rewrites the container so a player has both.
    expect((await finalized(id)).seekable).toBe(true);

    const media = await page.evaluate(async (recordingId) => {
      const el = document.createElement('audio');
      el.src = `/__rec/recordings/${recordingId}/audio`;
      await new Promise((resolve) => {
        el.onloadedmetadata = resolve;
        el.onerror = resolve;
        setTimeout(resolve, 6000);
      });
      const duration = el.duration;
      el.currentTime = 0.5;
      const landed = await new Promise<number | null>((resolve) => {
        el.onseeked = () => resolve(el.currentTime);
        setTimeout(() => resolve(null), 4000);
      });
      return { finite: Number.isFinite(duration), duration, landed };
    }, id);

    // Without a duration the scrub bar has no scale, which is what makes
    // dragging backwards guesswork.
    expect(media.finite).toBe(true);
    expect(media.duration).toBeGreaterThan(0);
    expect(media.landed).not.toBeNull();
  });
});

test.describe('downloads', () => {
  test('every artefact comes back as a file, named after the recording', async ({
    page,
    request,
  }) => {
    await armedStudio(page);
    await control(page, 'start', { title: 'Downloadable' });
    await expect.poll(async () => (await status(page)).durationMs).toBeGreaterThan(0);
    await control(page, 'stop');
    await expect.poll(async () => (await status(page)).status).toBe('idle');

    const [id] = await listOnDisk();
    const media = await request.get(`/__rec/recordings/${id}/download/media`);
    expect(media.status()).toBe(200);
    // Without the disposition the browser plays it instead of saving it.
    expect(media.headers()['content-disposition']).toContain(`filename="${id}.webm"`);
    expect((await media.body()).byteLength).toBeGreaterThan(1000);

    // Subtitles do not exist until it has been transcribed, and say so.
    const srt = await request.get(`/__rec/recordings/${id}/download/srt`);
    expect(srt.status()).toBe(404);
    expect((await srt.json()).error).toContain('not transcribed yet');
  });
});
