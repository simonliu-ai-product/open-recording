import { describe, expect, it } from 'vitest';
import type { Transcript } from '../files/store.ts';
import { toSrt, toVtt } from './subtitles.ts';

const transcript: Transcript = {
  model: '/models/ggml-small.bin',
  language: 'zh',
  createdAt: '2026-08-20T00:00:00.000Z',
  elapsedMs: 900,
  text: '',
  segments: [
    { start: 0, end: 5000, text: '大家好我是Simon' },
    { start: 5000, end: 7000, text: '歡迎來到本場演講' },
    // Whisper sometimes reports a cue with no length at all.
    { start: 7000, end: 7000, text: '今天的主題是Google ADK' },
  ],
};

describe('toSrt', () => {
  it('numbers the cues and writes SRT timestamps', () => {
    const srt = toSrt(transcript);
    expect(srt.startsWith('1\n00:00:00,000 --> 00:00:05,000\n大家好我是Simon\n')).toBe(true);
    expect(srt).toContain('2\n00:00:05,000 --> 00:00:07,000\n');
  });

  it('gives a zero-length cue enough time to be read', () => {
    expect(toSrt(transcript)).toContain('3\n00:00:07,000 --> 00:00:07,700\n');
  });
});

describe('toVtt', () => {
  it('leads with the WEBVTT header and uses a dot for the fraction', () => {
    const vtt = toVtt(transcript);
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true);
    expect(vtt).toContain('00:00:00.000 --> 00:00:05.000');
  });

  it('never lets a cue run into the next one', () => {
    const overlapping = {
      ...transcript,
      segments: [
        { start: 0, end: 9000, text: 'one' },
        { start: 2000, end: 4000, text: 'two' },
      ],
    };
    expect(toVtt(overlapping)).toContain('00:00:00.000 --> 00:00:02.000');
  });
});
