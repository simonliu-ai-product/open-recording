import type { ViteDevServer } from 'vite';
import { AUDIO_FILE, appendChunk, SCREEN_FILE } from '../../files/store.ts';
import { validateMutationRequest } from '../../http/request-guard.ts';
import type { ApiContext } from '../../ops/context.ts';
import { recorderHub, type StudioCommand } from '../../recorder/hub.ts';
import { fail, json, readBody, readRawBody } from './context.ts';

// GET  /__studio/stream                     SSE: recorder commands + state
// POST /__studio/armed                      page reports it now holds a microphone
// POST /__studio/sessions/:sessionId/ack    studio confirms its MediaRecorder is running
// POST /__studio/sessions/:sessionId/chunk  one MediaRecorder slice (application/octet-stream)
// POST /__studio/sessions/:sessionId/paused  studio confirms MediaRecorder.pause()
// POST /__studio/sessions/:sessionId/resumed studio confirms it is capturing again
// POST /__studio/sessions/:sessionId/done   studio flushed everything; session closes

/** One slice is `chunkMs` of Opus — 8 MB is far above that, and far below a memory problem. */
const MAX_CHUNK_BYTES = 8 * 1024 * 1024;

export function registerStudioRoutes(server: ViteDevServer, ctx: ApiContext): void {
  const hub = recorderHub(ctx.userCwd);

  server.middlewares.use('/__studio', async (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://local');
    const method = req.method ?? 'GET';

    try {
      if (method === 'GET' && url.pathname === '/stream') {
        res.statusCode = 200;
        res.setHeader('content-type', 'text/event-stream');
        res.setHeader('cache-control', 'no-cache, no-transform');
        res.setHeader('connection', 'keep-alive');
        res.flushHeaders?.();

        const send = (command: StudioCommand) => {
          res.write(`data: ${JSON.stringify(command)}\n\n`);
        };
        const detach = hub.attachStudio(send);
        // Proxies and browsers drop a stream that says nothing; the studio is
        // expected to sit idle for hours between recordings.
        const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000);
        const close = () => {
          clearInterval(heartbeat);
          detach();
        };
        req.on('close', close);
        res.on('close', close);
        return;
      }

      if (method === 'POST' && url.pathname === '/armed') {
        const guard = validateMutationRequest(req, { requireJsonBody: true });
        if (!guard.ok) return json(res, guard.status, { error: guard.error });
        const body = (await readBody(req)) as { studioId?: unknown };
        if (typeof body.studioId !== 'number') return json(res, 400, { error: 'invalid studioId' });
        return json(res, hub.markArmed(body.studioId, Date.now()) ? 200 : 409, hub.snapshot());
      }

      const match = url.pathname.match(
        /^\/sessions\/([A-Za-z0-9]+)\/(ack|chunk|paused|resumed|done)$/,
      );
      if (method === 'POST' && match) {
        const [, sessionId, action] = match;

        if (action === 'chunk') {
          const guard = validateMutationRequest(req);
          if (!guard.ok) return json(res, guard.status, { error: guard.error });

          const state = hub.snapshot();
          if (state.sessionId !== sessionId || !state.recordingId) {
            return json(res, 409, { error: 'stale session' });
          }
          const body = await readRawBody(req, MAX_CHUNK_BYTES);
          if (body.length === 0) return json(res, 200, { bytes: state.bytes });
          const name = state.kind === 'screen' ? SCREEN_FILE : AUDIO_FILE;
          const bytes = await appendChunk(ctx, state.recordingId, name, body);
          const durationMs = Number(url.searchParams.get('durationMs'));
          hub.noteProgress(sessionId, {
            bytes,
            ...(Number.isFinite(durationMs) && durationMs > 0 ? { durationMs } : {}),
          });
          return json(res, 200, { bytes });
        }

        const guard = validateMutationRequest(req, { requireJsonBody: true });
        if (!guard.ok) return json(res, guard.status, { error: guard.error });
        const body = (await readBody(req)) as {
          error?: string;
          durationMs?: number;
          kind?: 'audio' | 'screen';
        };

        if (action === 'paused' || action === 'resumed') {
          const moved = action === 'paused' ? hub.ackPaused(sessionId) : hub.ackResumed(sessionId);
          return json(res, moved ? 200 : 409, hub.snapshot());
        }

        if (action === 'ack') {
          const accepted = hub.ackRecording(sessionId, ctx.chunkMs, body.kind ?? 'audio');
          if (!accepted) {
            // Either the session moved on or the studio failed to open a
            // microphone; an error body is how the waiting caller learns why.
            if (body.error) hub.abandon(sessionId, body.error);
            return json(res, 409, { error: body.error ?? 'stale session' });
          }
          return json(res, 200, hub.snapshot());
        }

        const finished = hub.finish(sessionId, {
          ...(typeof body.durationMs === 'number' ? { durationMs: body.durationMs } : {}),
          ...(body.error ? { error: body.error } : {}),
        });
        return json(res, finished ? 200 : 409, hub.snapshot());
      }

      next();
    } catch (err) {
      fail(res, err);
    }
  });
}
