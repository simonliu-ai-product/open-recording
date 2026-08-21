import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import {
  mediaFileName,
  patchMeta,
  readMeta,
  recordingFile,
  SUBTITLE_SRT_FILE,
  SUBTITLE_VTT_FILE,
  TRANSCRIPT_FILE,
  TRANSCRIPT_MD_FILE,
  type Transcript,
  WAV_FILE,
} from '../files/store.ts';
import { ScriptConversionUnavailableError, scriptConversionAvailable } from '../stt/script.ts';
import { toSrt, toVtt } from '../stt/subtitles.ts';
import {
  inspectEnvironment,
  toMarkdown,
  transcribeFile,
  type WhisperEnvironment,
  WhisperUnavailableError,
} from '../stt/whisper.ts';
import { type ApiContext, OpsError } from './context.ts';

export type TranscribeOptions = {
  language?: string;
  model?: string;
  /** Re-run even when a transcript already exists. */
  force?: boolean;
  keepWav?: boolean;
};

export type TranscribeResult = {
  id: string;
  language: string;
  model: string;
  segmentCount: number;
  elapsedMs: number;
  markdown: string;
};

export type TranscribeEnvironment = WhisperEnvironment & {
  /** Which script transcripts are written in, and whether that is possible. */
  script: 'traditional' | 'simplified' | 'as-is';
  scriptConverter: boolean;
};

/**
 * Writes a transcript and everything derived from it. Markdown, SRT and VTT are
 * views of the same segments, so they are rewritten together — a corrected line
 * that reached the page but not the subtitles would be worse than the mistake.
 */
async function writeTranscript(
  ctx: ApiContext,
  id: string,
  title: string,
  transcript: Transcript,
): Promise<string> {
  const markdown = toMarkdown(title, transcript);
  const paths = {
    json: recordingFile(ctx, id, TRANSCRIPT_FILE),
    md: recordingFile(ctx, id, TRANSCRIPT_MD_FILE),
    srt: recordingFile(ctx, id, SUBTITLE_SRT_FILE),
    vtt: recordingFile(ctx, id, SUBTITLE_VTT_FILE),
  };
  if (!paths.json || !paths.md || !paths.srt || !paths.vtt) {
    throw new OpsError(400, `invalid recording id: ${id}`);
  }
  await writeFile(paths.json, `${JSON.stringify(transcript, null, 2)}\n`, 'utf8');
  await writeFile(paths.md, markdown, 'utf8');
  await writeFile(paths.srt, toSrt(transcript), 'utf8');
  await writeFile(paths.vtt, toVtt(transcript), 'utf8');
  return markdown;
}

/**
 * Corrects one line. Whisper mishears names and jargon — no model does not —
 * and a subtitle with the wrong name in it is not usable, so the text has to be
 * fixable without re-running anything.
 */
export async function editTranscriptSegment(
  ctx: ApiContext,
  id: string,
  index: number,
  text: string,
): Promise<Transcript> {
  const meta = await readMeta(ctx, id);
  if (!meta) throw new OpsError(404, `recording not found: ${id}`);

  const jsonPath = recordingFile(ctx, id, TRANSCRIPT_FILE);
  if (!jsonPath || !existsSync(jsonPath)) {
    throw new OpsError(404, `not transcribed yet: ${id}`);
  }
  const transcript = JSON.parse(await readFile(jsonPath, 'utf8')) as Transcript;
  if (!Number.isInteger(index) || index < 0 || index >= transcript.segments.length) {
    throw new OpsError(
      400,
      `no segment ${index} — the transcript has ${transcript.segments.length}`,
    );
  }

  const trimmed = text.trim();
  if (!trimmed)
    throw new OpsError(400, 'a segment cannot be emptied; delete the recording instead');

  const segments = transcript.segments.map((segment, i) =>
    i === index ? { ...segment, text: trimmed } : segment,
  );
  const next: Transcript = {
    ...transcript,
    segments,
    text: segments.map((s) => s.text).join('\n'),
  };

  await writeTranscript(ctx, id, meta.title, next);
  await patchMeta(ctx, id, {
    transcript: meta.transcript
      ? { ...meta.transcript, chars: next.text.length, segmentCount: segments.length }
      : undefined,
  });
  return next;
}

export async function transcribeEnvironment(ctx: ApiContext): Promise<TranscribeEnvironment> {
  return {
    ...(await inspectEnvironment(ctx.transcribe, ctx.userCwd)),
    script: ctx.transcribe.script ?? 'as-is',
    scriptConverter: await scriptConversionAvailable(ctx.userCwd),
  };
}

export async function transcribeRecording(
  ctx: ApiContext,
  id: string,
  opts: TranscribeOptions = {},
): Promise<TranscribeResult> {
  const meta = await readMeta(ctx, id);
  if (!meta) throw new OpsError(404, `recording not found: ${id}`);
  if (meta.status === 'recording') throw new OpsError(409, `still recording: ${id}`);

  const audio = recordingFile(ctx, id, mediaFileName(meta));
  if (!audio || !existsSync(audio)) throw new OpsError(404, `no audio for recording: ${id}`);

  const jsonPath = recordingFile(ctx, id, TRANSCRIPT_FILE);
  const mdPath = recordingFile(ctx, id, TRANSCRIPT_MD_FILE);
  const wavPath = recordingFile(ctx, id, WAV_FILE);
  if (!jsonPath || !mdPath || !wavPath) throw new OpsError(400, `invalid recording id: ${id}`);

  if (!opts.force && meta.transcript && existsSync(jsonPath)) {
    throw new OpsError(409, `already transcribed: ${id} — pass force to redo it`);
  }

  await patchMeta(ctx, id, { transcribing: true });

  let transcript: Transcript;
  try {
    transcript = await transcribeFile({
      audioPath: audio,
      wavPath,
      config: ctx.transcribe,
      userCwd: ctx.userCwd,
      ...(opts.language ? { language: opts.language } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.keepWav !== undefined ? { keepWav: opts.keepWav } : {}),
    });
  } catch (err) {
    await patchMeta(ctx, id, { transcribing: false });
    if (err instanceof ScriptConversionUnavailableError) {
      throw new OpsError(503, `${err.message} (run \`open-recording doctor\`)`);
    }
    if (err instanceof WhisperUnavailableError) {
      // A missing binary or model is a setup problem, not a bad request — it is
      // reported as one so `open-recording doctor` is the obvious next step.
      throw new OpsError(503, `${err.message} (run \`open-recording doctor\`)`);
    }
    throw err;
  }

  const markdown = await writeTranscript(ctx, id, meta.title, transcript);
  await patchMeta(ctx, id, {
    transcribing: false,
    transcript: {
      model: transcript.model,
      language: transcript.language,
      createdAt: transcript.createdAt,
      elapsedMs: transcript.elapsedMs,
      segmentCount: transcript.segments.length,
      chars: transcript.text.length,
    },
  });

  return {
    id,
    language: transcript.language,
    model: transcript.model,
    segmentCount: transcript.segments.length,
    elapsedMs: transcript.elapsedMs,
    markdown,
  };
}
