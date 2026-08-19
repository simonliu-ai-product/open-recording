import type { McpServer } from '@modelcontextprotocol/server';
import {
  type ApiContext,
  cancelRecording,
  deleteRecording,
  listRecordings,
  OpsError,
  pauseRecording,
  readNotes,
  readRecording,
  readTranscript,
  recorderStatus,
  renameRecording,
  resumeRecording,
  searchTranscripts,
  startRecording,
  stopRecording,
  tagRecording,
  transcribeEnvironment,
  transcribeRecording,
  writeNotes,
} from '@open-recording/core/ops';
import { z } from 'zod';

/**
 * Every tool is a thin wrapper over `@open-recording/core/ops` — the same
 * functions the dev server calls for the studio page. An agent and a person
 * therefore share one recorder: whoever presses stop, the other one sees it.
 */

/** Tools return text; JSON payloads go through as pretty-printed text blocks. */
function ok(value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text' as const, text }] };
}

/**
 * An OpsError is a refusal the caller can act on (503 no studio connected, 409
 * already recording), so it comes back as a tool error rather than a transport
 * failure.
 */
async function run(fn: () => Promise<unknown> | unknown) {
  try {
    return ok(await fn());
  } catch (err) {
    if (err instanceof OpsError) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `${err.status}: ${err.message}` }],
      };
    }
    throw err;
  }
}

export function registerTools(server: McpServer, ctx: ApiContext): void {
  server.registerTool(
    'recorder_status',
    {
      title: 'Recorder status',
      description:
        'Whether anything is recording or paused, and whether a studio page is connected to record through. Check this before starting.',
      inputSchema: z.object({}),
    },
    () => run(() => recorderStatus(ctx)),
  );

  server.registerTool(
    'start_recording',
    {
      title: 'Start recording',
      description:
        'Press record. Returns once the studio page confirms its microphone is live; fails if no studio is connected or permission is missing. One recording at a time.',
      inputSchema: z.object({
        title: z.string().optional().describe('what this recording is, e.g. "Weekly sync"'),
        tags: z.array(z.string()).optional(),
        note: z.string().optional().describe('context worth keeping beside the audio'),
      }),
    },
    ({ title, tags, note }) =>
      run(() =>
        startRecording(ctx, {
          ...(title ? { title } : {}),
          ...(tags ? { tags } : {}),
          ...(note ? { note } : {}),
        }),
      ),
  );

  server.registerTool(
    'stop_recording',
    {
      title: 'Stop recording',
      description:
        'Stop the open recording and finalize the file — from paused too, with no need to resume first. Pass transcribe to run whisper.cpp immediately, which blocks until the transcription finishes.',
      inputSchema: z.object({
        transcribe: z.boolean().optional().describe('transcribe as soon as the audio lands'),
        language: z.string().optional().describe('language code for the transcription, or `auto`'),
      }),
    },
    ({ transcribe, language }) =>
      run(async () => {
        const meta = await stopRecording(ctx);
        if (!transcribe) return meta;
        const result = await transcribeRecording(ctx, meta.id, {
          ...(language ? { language } : {}),
        });
        return { ...meta, transcript: result };
      }),
  );

  server.registerTool(
    'pause_recording',
    {
      title: 'Pause recording',
      description:
        'Pause without closing the recording — the audio stays one file, with the paused span simply absent from it. Use this for an interruption; use stop_recording when the session is over.',
      inputSchema: z.object({}),
    },
    () => run(() => pauseRecording(ctx)),
  );

  server.registerTool(
    'resume_recording',
    {
      title: 'Resume recording',
      description: 'Carry on capturing into the recording that is paused.',
      inputSchema: z.object({}),
    },
    () => run(() => resumeRecording(ctx)),
  );

  server.registerTool(
    'cancel_recording',
    {
      title: 'Cancel recording',
      description:
        'Stop the open recording and delete its audio. Use when the recording was a mistake.',
      inputSchema: z.object({}),
    },
    () => run(() => cancelRecording(ctx)),
  );

  server.registerTool(
    'list_recordings',
    {
      title: 'List recordings',
      description:
        'Every recording with its id, title, length, and whether it has been transcribed.',
      inputSchema: z.object({}),
    },
    () => run(() => listRecordings(ctx)),
  );

  server.registerTool(
    'read_recording',
    {
      title: 'Read recording metadata',
      description: 'Full metadata for one recording, including transcription details when present.',
      inputSchema: z.object({ id: z.string() }),
    },
    ({ id }) => run(() => readRecording(ctx, id)),
  );

  server.registerTool(
    'transcribe_recording',
    {
      title: 'Transcribe recording',
      description:
        'Run local whisper.cpp over a recording and store the transcript beside the audio. Refuses when a transcript exists unless force is set.',
      inputSchema: z.object({
        id: z.string(),
        language: z.string().optional().describe('language code, or `auto` (the default)'),
        model: z
          .string()
          .optional()
          .describe('path to a ggml model, overriding the configured one'),
        force: z.boolean().optional(),
      }),
    },
    ({ id, language, model, force }) =>
      run(() =>
        transcribeRecording(ctx, id, {
          ...(language ? { language } : {}),
          ...(model ? { model } : {}),
          ...(force ? { force } : {}),
        }),
      ),
  );

  server.registerTool(
    'read_transcript',
    {
      title: 'Read transcript',
      description:
        'The stored transcript. `markdown` (default) carries timestamps you can cite; `text` is prose only; `segments` is the timed data.',
      inputSchema: z.object({
        id: z.string(),
        view: z.enum(['markdown', 'text', 'segments']).optional(),
      }),
    },
    ({ id, view }) => run(() => readTranscript(ctx, id, view ?? 'markdown')),
  );

  server.registerTool(
    'search_transcripts',
    {
      title: 'Search transcripts',
      description:
        'Substring search across every stored transcript. Hits carry the recording id and the millisecond offset, so you can point at the moment.',
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().int().positive().max(100).optional(),
      }),
    },
    ({ query, limit }) => run(() => searchTranscripts(ctx, query, limit ?? 20)),
  );

  server.registerTool(
    'write_notes',
    {
      title: 'Write notes',
      description:
        'Store your own Markdown beside the audio — a summary, action items, decisions. Overwrites any previous notes.',
      inputSchema: z.object({ id: z.string(), notes: z.string() }),
    },
    ({ id, notes }) => run(() => writeNotes(ctx, id, notes)),
  );

  server.registerTool(
    'read_notes',
    {
      title: 'Read notes',
      description: 'The Markdown notes stored beside a recording.',
      inputSchema: z.object({ id: z.string() }),
    },
    ({ id }) => run(() => readNotes(ctx, id)),
  );

  server.registerTool(
    'rename_recording',
    {
      title: 'Rename recording',
      description: 'Change a recording’s title. The id never moves — it is the folder on disk.',
      inputSchema: z.object({ id: z.string(), title: z.string() }),
    },
    ({ id, title }) => run(() => renameRecording(ctx, id, title)),
  );

  server.registerTool(
    'tag_recording',
    {
      title: 'Tag recording',
      description: 'Replace a recording’s tags.',
      inputSchema: z.object({ id: z.string(), tags: z.array(z.string()) }),
    },
    ({ id, tags }) => run(() => tagRecording(ctx, id, tags)),
  );

  server.registerTool(
    'delete_recording',
    {
      title: 'Delete recording',
      description:
        'Permanently delete a recording — audio, transcript, and notes. Confirm with the user first.',
      inputSchema: z.object({ id: z.string() }),
    },
    ({ id }) => run(() => deleteRecording(ctx, id)),
  );

  server.registerTool(
    'transcription_environment',
    {
      title: 'Transcription environment',
      description:
        'Which whisper.cpp binary, model, and ffmpeg the workspace resolved. Read this when a transcription is refused with a 503.',
      inputSchema: z.object({}),
    },
    () => run(() => transcribeEnvironment(ctx)),
  );
}
