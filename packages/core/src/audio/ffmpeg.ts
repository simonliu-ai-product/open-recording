import { spawn } from 'node:child_process';

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

/** Audio length in milliseconds, or null when ffprobe is unavailable or the file is unreadable. */
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
    if (result.code !== 0) return null;
    const seconds = Number.parseFloat(result.stdout.trim());
    return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
  } catch {
    return null;
  }
}
