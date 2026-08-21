import { existsSync } from 'node:fs';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
export const RECORDINGS = path.resolve(here, '..', 'fixture', 'recordings');

export type Meta = {
  id: string;
  title: string;
  status: string;
  durationMs: number;
  sizeBytes: number;
  source: string;
  kind: 'audio' | 'screen';
  file: string;
};

/** The workspace holds one recorder, so each test starts from an empty shelf. */
export async function clearRecordings(): Promise<void> {
  if (!existsSync(RECORDINGS)) return;
  for (const entry of await readdir(RECORDINGS)) {
    if (entry === '.gitkeep') continue;
    await rm(path.join(RECORDINGS, entry), { recursive: true, force: true });
  }
}

export async function listOnDisk(): Promise<string[]> {
  if (!existsSync(RECORDINGS)) return [];
  return (await readdir(RECORDINGS)).filter((entry) => entry !== '.gitkeep').sort();
}

export async function readMeta(id: string): Promise<Meta> {
  return JSON.parse(await readFile(path.join(RECORDINGS, id, 'meta.json'), 'utf8')) as Meta;
}

export async function audioSize(id: string): Promise<number> {
  return (await stat(path.join(RECORDINGS, id, 'audio.webm'))).size;
}

/**
 * Opens the studio and takes the microphone. Arming is a user gesture on
 * purpose — the permission prompt cannot be answered from an agent — so every
 * test that records starts here.
 */
export async function armedStudio(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByText('connected', { exact: true })).toBeVisible();
  await chooseSource(page, 'Microphone');
  await expect(page.getByText('Microphone ready')).toBeVisible();
}

/**
 * Picks a source from the record button's menu, which is where taking one
 * happens: the permission prompt and Chrome's tab picker both need the click.
 */
export async function chooseSource(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: 'Choose what to record' }).click();
  await page.getByRole('button', { name: label, exact: true }).click();
}

/** The recorder's own view of itself, straight from the dev API. */
export async function status(
  page: Page,
): Promise<{ status: string; durationMs: number; studios: number }> {
  return await page.evaluate(async () => {
    const res = await fetch('/__rec/status');
    return (await res.json()) as { status: string; durationMs: number; studios: number };
  });
}

/** Drives the recorder the way an agent does — over HTTP, not by clicking. */
export async function control(page: Page, action: string, body?: unknown): Promise<unknown> {
  return await page.evaluate(
    async ([path, payload]) => {
      const res = await fetch(`/__rec/${path}`, {
        method: 'POST',
        ...(payload === null
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }),
      });
      return { ok: res.ok, status: res.status, body: await res.json() };
    },
    [action, body ?? null] as [string, unknown],
  );
}
