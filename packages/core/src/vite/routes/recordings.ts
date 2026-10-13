import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { ViteDevServer } from 'vite';
import { validateMutationRequest } from '../../http/request-guard.ts';
import type { ApiContext } from '../../ops/context.ts';
import { readCurrent, writeCurrent } from '../../ops/current.ts';
import { importRecording } from '../../ops/import.ts';
import {
  addBookmark,
  type DownloadKind,
  deleteBookmark,
  deleteRecording,
  downloadPath,
  listRecordings,
  mediaPath,
  readNotes,
  readRecording,
  readSubtitles,
  readTranscript,
  renameRecording,
  searchTranscripts,
  tagRecording,
  writeNotes,
} from '../../ops/recordings.ts';
import {
  cancelRecording,
  markRecordingMoment,
  pauseRecording,
  recorderStatus,
  resumeRecording,
  startRecording,
  stopRecording,
} from '../../ops/session.ts';
import {
  editTranscriptSegment,
  transcribeEnvironment,
  transcribeRecording,
} from '../../ops/transcribe.ts';
import { fail, json, readBody, readRawBody } from './context.ts';

const MAX_IMPORT_BYTES = 200 * 1024 * 1024;

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

      if (url.pathname === '/current') {
        if (method === 'GET') {
          return json(res, 200, await readCurrent(ctx));
        }
        if (method === 'POST') {
          const guard = validateMutationRequest(req, { requireJsonBody: true });
          if (!guard.ok) return json(res, guard.status, { error: guard.error });
          const body = (await readBody(req)) as {
            recordingId?: string | null;
            title?: string;
            currentTimeMs?: number;
          };
          return json(
            res,
            200,
            await writeCurrent(ctx, {
              recordingId: body.recordingId ?? null,
              ...(body.title ? { title: body.title } : {}),
              ...(typeof body.currentTimeMs === 'number'
                ? { currentTimeMs: body.currentTimeMs }
                : {}),
            }),
          );
        }
      }

      const CONTROL = ['/start', '/pause', '/resume', '/stop', '/cancel', '/mark'];
      if (method === 'POST' && CONTROL.includes(url.pathname)) {
        const guard = validateMutationRequest(req);
        if (!guard.ok) return json(res, guard.status, { error: guard.error });

        if (url.pathname === '/pause') return json(res, 200, await pauseRecording(ctx));
        if (url.pathname === '/resume') return json(res, 200, await resumeRecording(ctx));
        if (url.pathname === '/stop') return json(res, 200, await stopRecording(ctx));
        if (url.pathname === '/cancel') return json(res, 200, await cancelRecording(ctx));
        if (url.pathname === '/mark') {
          const body = (await readBody(req)) as { label?: string };
          return json(res, 200, await markRecordingMoment(ctx, body.label));
        }

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

      if (method === 'POST' && url.pathname === '/import') {
        const guard = validateMutationRequest(req);
        if (!guard.ok) return json(res, guard.status, { error: guard.error });
        const contentType = String(req.headers['content-type'] ?? '');
        if (contentType.includes('application/json')) {
          const body = (await readBody(req)) as {
            filePath?: string;
            title?: string;
            tags?: string[];
            note?: string;
            transcribe?: boolean;
          };
          return json(
            res,
            200,
            await importRecording(ctx, {
              ...(body.filePath ? { filePath: body.filePath } : {}),
              ...(body.title ? { title: body.title } : {}),
              ...(Array.isArray(body.tags) ? { tags: body.tags } : {}),
              ...(body.note ? { note: body.note } : {}),
              ...(body.transcribe ? { transcribe: body.transcribe } : {}),
              source: 'studio',
            }),
          );
        }
        const bytes = await readRawBody(req, MAX_IMPORT_BYTES);
        const filename = url.searchParams.get('filename') ?? 'imported.webm';
        const title = url.searchParams.get('title') ?? undefined;
        return json(
          res,
          200,
          await importRecording(ctx, {
            bytes,
            filename,
            ...(title ? { title } : {}),
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
        const id = decodeURIComponent(audioMatch[1]);
        const file = await mediaPath(ctx, id);
        const info = await stat(file);
        const meta = await readRecording(ctx, id);
        res.setHeader('content-type', meta.kind === 'screen' ? 'video/webm' : 'audio/webm');
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

      const downloadMatch = url.pathname.match(
        /^\/recordings\/([^/]+)\/download\/(media|transcript|srt|vtt|segments)$/,
      );
      if (method === 'GET' && downloadMatch) {
        const [, rawId, kind] = downloadMatch;
        const file = await downloadPath(ctx, decodeURIComponent(rawId), kind as DownloadKind);
        const info = await stat(file.path);
        res.statusCode = 200;
        res.setHeader('content-type', file.contentType);
        res.setHeader('content-length', String(info.size));
        // Without this the browser plays the file instead of saving it.
        res.setHeader('content-disposition', `attachment; filename="${file.filename}"`);
        createReadStream(file.path).pipe(res);
        return;
      }

      const vttMatch = url.pathname.match(/^\/recordings\/([^/]+)\/subtitles\.vtt$/);
      if (method === 'GET' && vttMatch) {
        const text = await readSubtitles(ctx, decodeURIComponent(vttMatch[1]), 'vtt');
        res.statusCode = 200;
        res.setHeader('content-type', 'text/vtt; charset=utf-8');
        res.setHeader('cache-control', 'no-store');
        res.end(text);
        return;
      }

      const transcriptMatch = url.pathname.match(/^\/recordings\/([^/]+)\/transcript$/);
      if (transcriptMatch) {
        const id = decodeURIComponent(transcriptMatch[1]);
        if (method === 'GET') {
          const view = url.searchParams.get('view');
          const result = await readTranscript(
            ctx,
            id,
            view === 'text' || view === 'segments' ? view : 'markdown',
          );
          return json(res, 200, typeof result === 'string' ? { text: result } : result);
        }
        if (method === 'PATCH') {
          const guard = validateMutationRequest(req, { requireJsonBody: true });
          if (!guard.ok) return json(res, guard.status, { error: guard.error });
          const body = (await readBody(req)) as {
            index?: number;
            text?: string;
            speaker?: string | null;
            starred?: boolean;
          };
          if (typeof body.index !== 'number') {
            return json(res, 400, { error: 'index is required' });
          }
          return json(
            res,
            200,
            await editTranscriptSegment(ctx, id, body.index, {
              ...(body.text !== undefined ? { text: body.text } : {}),
              ...(body.speaker !== undefined ? { speaker: body.speaker } : {}),
              ...(body.starred !== undefined ? { starred: body.starred } : {}),
            }),
          );
        }
      }

      const bookmarksMatch = url.pathname.match(/^\/recordings\/([^/]+)\/bookmarks(?:\/([^/]+))?$/);
      if (bookmarksMatch) {
        const id = decodeURIComponent(bookmarksMatch[1]);
        const bookmarkId = bookmarksMatch[2] ? decodeURIComponent(bookmarksMatch[2]) : null;
        if (method === 'POST' && !bookmarkId) {
          const guard = validateMutationRequest(req, { requireJsonBody: true });
          if (!guard.ok) return json(res, guard.status, { error: guard.error });
          const body = (await readBody(req)) as { atMs?: number; label?: string };
          return json(
            res,
            200,
            await addBookmark(ctx, id, {
              atMs: Number(body.atMs ?? 0),
              label: String(body.label ?? 'Bookmark'),
            }),
          );
        }
        if (method === 'DELETE' && bookmarkId) {
          const guard = validateMutationRequest(req);
          if (!guard.ok) return json(res, guard.status, { error: guard.error });
          return json(res, 200, await deleteBookmark(ctx, id, bookmarkId));
        }
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
          vocabulary?: string[];
          force?: boolean;
        };
        return json(
          res,
          200,
          await transcribeRecording(ctx, decodeURIComponent(transcribeMatch[1]), {
            ...(body.language ? { language: body.language } : {}),
            ...(body.model ? { model: body.model } : {}),
            ...(Array.isArray(body.vocabulary) ? { vocabulary: body.vocabulary } : {}),
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
