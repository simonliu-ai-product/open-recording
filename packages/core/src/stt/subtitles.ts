import type { Transcript, TranscriptSegment } from '../files/store.ts';

function stamp(ms: number, separator: ',' | '.'): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const frac = total % 1000;
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}${separator}${pad(frac, 3)}`;
}

/** Whisper can report a cue that ends where it starts; a subtitle has to last. */
const MIN_CUE_MS = 700;

function cueEnd(segment: TranscriptSegment, next: TranscriptSegment | undefined): number {
  const floor = segment.start + MIN_CUE_MS;
  const end = Math.max(segment.end, floor);
  return next ? Math.min(end, next.start) : end;
}

export function toSrt(transcript: Transcript): string {
  return `${transcript.segments
    .map((segment, i) => {
      const end = cueEnd(segment, transcript.segments[i + 1]);
      return `${i + 1}\n${stamp(segment.start, ',')} --> ${stamp(end, ',')}\n${segment.text}\n`;
    })
    .join('\n')}`;
}

export function toVtt(transcript: Transcript): string {
  const cues = transcript.segments.map((segment, i) => {
    const end = cueEnd(segment, transcript.segments[i + 1]);
    return `${stamp(segment.start, '.')} --> ${stamp(end, '.')}\n${segment.text}\n`;
  });
  return `WEBVTT\n\n${cues.join('\n')}`;
}
