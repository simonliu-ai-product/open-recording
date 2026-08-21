import { spawn } from 'node:child_process';
import { rename, unlink } from 'node:fs/promises';

export type RunResult = { code: number; stdout: string; stderr: string };

export function run(bin: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/**
 * whisper.cpp reads 16 kHz mono PCM and nothing else, while MediaRecorder emits
 * Opus in a WebM container. This is the one conversion in the pipeline.
 */
export async function toWhisperWav(ffmpeg: string, input: string, output: string): Promise<void> {
  const result = await run(ffmpeg, [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    input,
    // A screen recording carries a video track whisper has no use for.
    '-vn',
    '-ar',
    '16000',
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    output,
  ]);
  if (result.code !== 0) {
    throw new Error(`ffmpeg failed (${result.code}): ${result.stderr.trim() || 'no output'}`);
  }
}

/**
 * Length by decoding the file. MediaRecorder writes a live stream, so its WebM
 * carries no duration in the header and ffprobe reports none — the only honest
 * answer comes from playing it through.
 */
async function decodedDurationMs(ffmpeg: string, input: string): Promise<number | null> {
  const result = await run(ffmpeg, ['-hide_banner', '-i', input, '-f', 'null', '-']).catch(
    () => null,
  );
  return result ? lastReportedTimeMs(result.stderr) : null;
}

/** ffmpeg reports progress on stderr; the last `time=` it printed is the whole length. */
export function lastReportedTimeMs(stderr: string): number | null {
  const times = [...stderr.matchAll(/time=(\d+):(\d+):(\d+)\.(\d+)/g)];
  const last = times[times.length - 1];
  if (!last) return null;
  const [, h, m, sec, frac] = last;
  return (
    Number(h) * 3_600_000 +
    Number(m) * 60_000 +
    Number(sec) * 1_000 +
    Number(frac.padEnd(3, '0').slice(0, 3))
  );
}

/**
 * Rewrites the container so the file can be seeked.
 *
 * MediaRecorder writes a live stream: no duration in the header and no index of
 * where the clusters are, so a player has no timeline to scrub and dragging
 * backwards is guesswork. Copying the streams into a fresh container — no
 * re-encoding, hundredths of a second even for a long recording — gives it
 * both.
 *
 * The original is replaced only once the new file exists and reports a
 * duration. A recording is not worth risking to a tidier container.
 */
export async function remuxSeekable(ffmpeg: string, file: string): Promise<boolean> {
  const target = `${file}.seekable`;
  try {
    const result = await run(ffmpeg, [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      file,
      '-c',
      'copy',
      '-f',
      'webm',
      target,
    ]);
    if (result.code !== 0) throw new Error(result.stderr.trim() || 'remux failed');

    const duration = await probeDurationMs(ffmpeg, target);
    if (!duration) throw new Error('remuxed file still reports no duration');

    await rename(target, file);
    return true;
  } catch {
    await unlink(target).catch(() => {});
    return false;
  }
}

/** Audio length in milliseconds, or null when ffmpeg is unavailable or the file is unreadable. */
export async function probeDurationMs(ffmpeg: string, input: string): Promise<number | null> {
  const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/, (m) => m.replace('ffmpeg', 'ffprobe'));
  try {
    const result = await run(ffprobe, [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      input,
    ]);
    if (result.code === 0) {
      const seconds = Number.parseFloat(result.stdout.trim());
      if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds * 1000);
    }
    return await decodedDurationMs(ffmpeg, input);
  } catch {
    return null;
  }
}
