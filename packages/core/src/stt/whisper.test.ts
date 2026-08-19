import { describe, expect, it } from 'vitest';
import { formatTimestamp, parseWhisperJson, toMarkdown } from './whisper.ts';

const WHISPER_OUTPUT = JSON.stringify({
  result: { language: 'zh' },
  transcription: [
    { offsets: { from: 0, to: 3200 }, text: ' 今天的會議重點是排程。' },
    { offsets: { from: 3200, to: 7000 }, text: '  ' },
    { offsets: { from: 7000, to: 11500 }, text: ' 下週要交出第一版。' },
  ],
});

describe('parseWhisperJson', () => {
  it('keeps offsets and trims whisper’s leading spaces', () => {
    const { language, segments } = parseWhisperJson(WHISPER_OUTPUT);
    expect(language).toBe('zh');
    expect(segments).toEqual([
      { start: 0, end: 3200, text: '今天的會議重點是排程。' },
      { start: 7000, end: 11500, text: '下週要交出第一版。' },
    ]);
  });

  it('drops blank segments rather than emitting empty lines', () => {
    expect(parseWhisperJson(WHISPER_OUTPUT).segments).toHaveLength(2);
  });

  it('survives a payload with no transcription at all', () => {
    expect(parseWhisperJson('{}')).toEqual({ language: 'unknown', segments: [] });
  });
});

describe('formatTimestamp', () => {
  it('drops the hour until there is one', () => {
    expect(formatTimestamp(0)).toBe('00:00');
    expect(formatTimestamp(65_000)).toBe('01:05');
    expect(formatTimestamp(3_725_000)).toBe('1:02:05');
  });
});

describe('toMarkdown', () => {
  it('leads every line with a citable timestamp', () => {
    const markdown = toMarkdown('Weekly sync', {
      model: '/models/ggml-large-v3-turbo.bin',
      language: 'zh',
      createdAt: '2026-08-19T06:15:30.000Z',
      elapsedMs: 4200,
      text: '',
      segments: parseWhisperJson(WHISPER_OUTPUT).segments,
    });
    expect(markdown).toContain('# Weekly sync');
    expect(markdown).toContain('- model: ggml-large-v3-turbo.bin');
    expect(markdown).toContain('`00:00` 今天的會議重點是排程。');
    expect(markdown).toContain('`00:07` 下週要交出第一版。');
  });
});
