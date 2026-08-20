import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import {
  AUDIO_FILE,
  patchMeta,
  readMeta,
  recordingFile,
  TRANSCRIPT_FILE,
  TRANSCRIPT_MD_FILE,
  type Transcript,
  WAV_FILE,
} from '../files/store.ts';
import { ScriptConversionUnavailableError, scriptConversionAvailable } from '../stt/script.ts';
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

  const audio = recordingFile(ctx, id, AUDIO_FILE);
  if (!audio || !existsSync(audio)) throw new OpsError(404, `no audio for recording: ${id}`);

  const jsonPath = recordingFile(ctx, id, TRANSCRIPT_FILE);
  const mdPath = recordingFile(ctx, id, TRANSCRIPT_MD_FILE);
  const wavPath = recordingFile(ctx, id, WAV_FILE);
  if (!jsonPath || !mdPath || !wavPath) throw new OpsError(400, `invalid recording id: ${id}`);

  if (!opts.force && meta.transcript && existsSync(jsonPath)) {
    throw new OpsError(409, `already transcribed: ${id} — pass force to redo it`);
  }

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

  const markdown = toMarkdown(meta.title, transcript);
  await writeFile(jsonPath, `${JSON.stringify(transcript, null, 2)}\n`, 'utf8');
  await writeFile(mdPath, markdown, 'utf8');
  await patchMeta(ctx, id, {
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
