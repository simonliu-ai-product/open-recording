import { describe, expect, it } from 'vitest';
import { lastReportedTimeMs } from './ffmpeg.ts';

// A MediaRecorder file carries no duration in its header, so this parse is the
// only place the real length comes from.
const STDERR = `
Input #0, matroska,webm, from 'audio.webm':
  Duration: N/A, start: 0.000000, bitrate: N/A
size=       0KiB time=00:00:02.01 bitrate=   0.2kbits/s speed=4.01x
size=       0KiB time=00:00:04.25 bitrate=   0.1kbits/s speed=8.49x
`;

describe('lastReportedTimeMs', () => {
  it('takes the last progress line, not the first', () => {
    expect(lastReportedTimeMs(STDERR)).toBe(4250);
  });

  it('reads hours and minutes', () => {
    expect(lastReportedTimeMs('time=01:02:03.50')).toBe(3_723_500);
  });

  it('pads a short fraction rather than misreading it', () => {
    expect(lastReportedTimeMs('time=00:00:01.5')).toBe(1500);
  });

  it('is null when ffmpeg reported no progress at all', () => {
    expect(lastReportedTimeMs('Duration: N/A')).toBeNull();
  });
});
