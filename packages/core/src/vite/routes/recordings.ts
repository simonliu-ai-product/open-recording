import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { ViteDevServer } from 'vite';
import { validateMutationRequest } from '../../http/request-guard.ts';
import type { ApiContext } from '../../ops/context.ts';
import {
  audioPath,
  deleteRecording,
  listRecordings,
  readNotes,
  readRecording,
  readTranscript,
  renameRecording,
  searchTranscripts,
  tagRecording,
  writeNotes,
} from '../../ops/recordings.ts';
import {
  cancelRecording,
  recorderStatus,
  startRecording,
  stopRecording,
} from '../../ops/session.ts';
import { transcribeEnvironment, transcribeRecording } from '../../ops/transcribe.ts';
import { fail, json, readBody } from './context.ts';

// GET    /__rec/status                 recorder state machine snapshot
// GET    /__rec/environment            whisper + ffmpeg availability
// POST   /__rec/start                  { title?, tags?, note? }
// POST   /__rec/stop
// POST   /__rec/cancel
// GET    /__rec/search?q=&limit=      substring search across transcripts
// GET    /__rec/recordings             list
// GET    /__rec/recordings/:id         meta
// GET    /__rec/recordings/:id/audio   the webm, range-less but seekable enough for <audio>
// GET    /__rec/recordings/:id/transcript?view=markdown|text|segments
// GET    /__rec/recordings/:id/notes       agent-written Markdown beside the audio
// POST   /__rec/recordings/:id/transcribe  { language?, model?, force? }
// PATCH  /__rec/recordings/:id         { title?, tags?, notes? }
// DELETE /__rec/recordings/:id

export function registerRecordingRoutes(server: ViteDevServer, ctx: ApiContext): void {
  server.middlewares.use('/__rec', async (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://local');
    const method = req.method ?? 'GET';

    try {
      if (method === 'GET' && url.pathname === '/status') {
        return json(res, 200, recorderStatus(ctx));
      }

      if (method === 'GET' && url.pathname === '/environment') {
        return json(res, 200, await transcribeEnvironment(ctx));
      }

      if (
        method === 'POST' &&
        (url.pathname === '/start' || url.pathname === '/stop' || url.pathname === '/cancel')
      ) {
        const guard = validateMutationRequest(req);
        if (!guard.ok) return json(res, guard.status, { error: guard.error });

        if (url.pathname === '/stop') return json(res, 200, await stopRecording(ctx));
        if (url.pathname === '/cancel') return json(res, 200, await cancelRecording(ctx));

        const body = (await readBody(req)) as { title?: string; tags?: string[]; note?: string };
        return json(
          res,
          200,
          await startRecording(ctx, {
            ...(body.title ? { title: body.title } : {}),
            ...(Array.isArray(body.tags) ? { tags: body.tags } : {}),
            ...(body.note ? { note: body.note } : {}),
            source: 'studio',
          }),
        );
      }

      if (method === 'GET' && url.pathname === '/search') {
        const limit = Number(url.searchParams.get('limit'));
        return json(
          res,
          200,
          await searchTranscripts(
            ctx,
            url.searchParams.get('q') ?? '',
            Number.isFinite(limit) && limit > 0 ? limit : 20,
          ),
        );
      }

      if (method === 'GET' && url.pathname === '/recordings') {
        return json(res, 200, await listRecordings(ctx));
      }

      const audioMatch = url.pathname.match(/^\/recordings\/([^/]+)\/audio$/);
      if (method === 'GET' && audioMatch) {
        const file = audioPath(ctx, decodeURIComponent(audioMatch[1]));
        const info = await stat(file);
        res.setHeader('content-type', 'audio/webm');
        res.setHeader('cache-control', 'no-store');
        // Without byte ranges a browser cannot seek, and Chrome will not even
        // report a duration for the stream — a recording you cannot scrub is
        // not much of a recording.
        res.setHeader('accept-ranges', 'bytes');

        const range = req.headers.range;
        const parsed = typeof range === 'string' ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
        if (parsed) {
          const [, rawStart, rawEnd] = parsed;
          const start = rawStart ? Number(rawStart) : info.size - Number(rawEnd);
          const end = rawStart && rawEnd ? Math.min(Number(rawEnd), info.size - 1) : info.size - 1;
          if (!Number.isFinite(start) || start < 0 || start > end) {
            res.statusCode = 416;
            res.setHeader('content-range', `bytes */${info.size}`);
            res.end();
            return;
          }
          res.statusCode = 206;
          res.setHeader('content-range', `bytes ${start}-${end}/${info.size}`);
          res.setHeader('content-length', String(end - start + 1));
          createReadStream(file, { start, end }).pipe(res);
          return;
        }

        res.statusCode = 200;
        res.setHeader('content-length', String(info.size));
        createReadStream(file).pipe(res);
        return;
      }

      const transcriptMatch = url.pathname.match(/^\/recordings\/([^/]+)\/transcript$/);
      if (method === 'GET' && transcriptMatch) {
        const view = url.searchParams.get('view');
        const result = await readTranscript(
          ctx,
          decodeURIComponent(transcriptMatch[1]),
          view === 'text' || view === 'segments' ? view : 'markdown',
        );
        return json(res, 200, typeof result === 'string' ? { text: result } : result);
      }

      const notesMatch = url.pathname.match(/^\/recordings\/([^/]+)\/notes$/);
      if (method === 'GET' && notesMatch) {
        return json(res, 200, { text: await readNotes(ctx, decodeURIComponent(notesMatch[1])) });
      }

      const transcribeMatch = url.pathname.match(/^\/recordings\/([^/]+)\/transcribe$/);
      if (method === 'POST' && transcribeMatch) {
        const guard = validateMutationRequest(req);
        if (!guard.ok) return json(res, guard.status, { error: guard.error });
        const body = (await readBody(req)) as {
          language?: string;
          model?: string;
          force?: boolean;
        };
        return json(
          res,
          200,
          await transcribeRecording(ctx, decodeURIComponent(transcribeMatch[1]), {
            ...(body.language ? { language: body.language } : {}),
            ...(body.model ? { model: body.model } : {}),
            ...(body.force ? { force: body.force } : {}),
          }),
        );
      }

      const idMatch = url.pathname.match(/^\/recordings\/([^/]+)$/);
      if (idMatch) {
        const id = decodeURIComponent(idMatch[1]);

        if (method === 'GET') return json(res, 200, await readRecording(ctx, id));

        if (method === 'PATCH') {
          const guard = validateMutationRequest(req, { requireJsonBody: true });
          if (!guard.ok) return json(res, guard.status, { error: guard.error });
          const body = (await readBody(req)) as { title?: string; tags?: string[]; notes?: string };
          if (body.title !== undefined) await renameRecording(ctx, id, body.title);
          if (Array.isArray(body.tags)) await tagRecording(ctx, id, body.tags);
          if (typeof body.notes === 'string') await writeNotes(ctx, id, body.notes);
          return json(res, 200, await readRecording(ctx, id));
        }

        if (method === 'DELETE') {
          const guard = validateMutationRequest(req);
          if (!guard.ok) return json(res, guard.status, { error: guard.error });
          return json(res, 200, await deleteRecording(ctx, id));
        }
      }

      next();
    } catch (err) {
      fail(res, err);
    }
  });
}
