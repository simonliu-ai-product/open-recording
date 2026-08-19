import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { newRecordingId, RECORDING_ID_RE, recordingDir, slugify } from './store.ts';

const roots = { recordingsRoot: path.resolve('/workspace/recordings') };

describe('recording ids', () => {
  it('slugs a title into the id alphabet', () => {
    expect(slugify('Weekly Sync — Product')).toBe('weekly-sync-product');
    expect(slugify('  trailing---dashes  ')).toBe('trailing-dashes');
  });

  it('falls back to the timestamp when a title has no ASCII to slug', () => {
    const id = newRecordingId('每週同步會議', new Date(2026, 7, 19, 14, 15, 30));
    expect(id).toBe('20260819-141530');
    expect(RECORDING_ID_RE.test(id)).toBe(true);
  });

  it('leads with a sortable timestamp', () => {
    const id = newRecordingId('Weekly Sync', new Date(2026, 7, 19, 14, 15, 30));
    expect(id).toBe('20260819-141530-weekly-sync');
  });
});

describe('recordingDir', () => {
  it('resolves a valid id under the recordings root', () => {
    expect(recordingDir(roots, '20260819-141530-sync')).toBe(
      path.join(roots.recordingsRoot, '20260819-141530-sync'),
    );
  });

  it('refuses traversal and anything outside the id alphabet', () => {
    expect(recordingDir(roots, '../etc')).toBeNull();
    expect(recordingDir(roots, '..')).toBeNull();
    expect(recordingDir(roots, 'a/b')).toBeNull();
    expect(recordingDir(roots, 'Uppercase')).toBeNull();
    expect(recordingDir(roots, '')).toBeNull();
  });
});
