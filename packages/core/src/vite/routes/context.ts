import type { ServerResponse } from 'node:http';
import type { Connect } from 'vite';
import type { OpenRecordingConfig } from '../../config.ts';
import { type ApiContext, makeContext } from '../../ops/context.ts';

export type ApiPluginOptions = {
  userCwd: string;
  coreVersion: string;
  config?: OpenRecordingConfig;
};

export function contextFor(opts: ApiPluginOptions): ApiContext {
  return makeContext(opts);
}

export type { ApiContext };
export { makeContext };

export async function readBody(req: Connect.IncomingMessage): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

export async function readRawBody(
  req: Connect.IncomingMessage,
  limitBytes: number,
): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

/** Maps an OpsError onto its status; anything else is a 500 the caller did not cause. */
export function fail(res: ServerResponse, err: unknown): void {
  const status = (err as { status?: number }).status;
  const message = err instanceof Error ? err.message : String(err);
  json(res, typeof status === 'number' ? status : 500, { error: message });
}
