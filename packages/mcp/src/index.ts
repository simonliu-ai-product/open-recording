import { toNodeHandler } from '@modelcontextprotocol/node';
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  McpServer,
  originValidationResponse,
} from '@modelcontextprotocol/server';
import type { OpenRecordingConfig } from '@open-recording/core';
import { type ApiContext, makeContext } from '@open-recording/core/ops';
import { registerTools } from './tools.ts';

export type OpenRecordingMcpOptions = {
  /** The workspace root — the directory holding `recordings/`. */
  userCwd: string;
  version?: string;
  config?: OpenRecordingConfig;
  /**
   * Extra hostnames allowed in Host/Origin headers. Loopback is always allowed;
   * add to this only when the endpoint is deliberately exposed.
   */
  allowedHosts?: string[];
};

function contextFor(opts: OpenRecordingMcpOptions): ApiContext {
  return makeContext({
    userCwd: opts.userCwd,
    coreVersion: opts.version ?? '0.0.0',
    ...(opts.config ? { config: opts.config } : {}),
  });
}

/**
 * A fresh server per request. The recorder state it acts on is not held here —
 * it lives in the dev server process this endpoint is mounted on — so there is
 * nothing worth carrying between calls, which is the stateless shape that lets
 * any client connect without a session handshake.
 */
export function createOpenRecordingMcpServer(opts: OpenRecordingMcpOptions): McpServer {
  const server = new McpServer({
    name: 'open-recording',
    version: opts.version ?? '0.0.0',
    title: 'open-recording',
  });
  registerTools(server, contextFor(opts));
  return server;
}

export function createOpenRecordingMcpHandler(opts: OpenRecordingMcpOptions) {
  const allowedHostnames = [...localhostAllowedHostnames(), ...(opts.allowedHosts ?? [])];
  const allowedOrigins = [...localhostAllowedOrigins(), ...(opts.allowedHosts ?? [])];
  const handler = createMcpHandler(() => createOpenRecordingMcpServer(opts));

  return {
    ...handler,
    /**
     * These tools hold a microphone and write to the user's disk, so a page in
     * the browser must not be able to drive them. Rejecting unexpected Host and
     * Origin headers is what closes the DNS-rebinding path onto a loopback
     * endpoint.
     */
    fetch: async (request: Request): Promise<Response> => {
      const hostRejection = hostHeaderValidationResponse(request, allowedHostnames);
      if (hostRejection) return hostRejection;
      const originRejection = originValidationResponse(request, allowedOrigins);
      if (originRejection) return originRejection;
      return handler.fetch(request);
    },
  };
}

/** Connect/Express-style middleware, for mounting on the dev server. */
export function createOpenRecordingMcpMiddleware(opts: OpenRecordingMcpOptions) {
  return toNodeHandler(createOpenRecordingMcpHandler(opts));
}
