import type { Plugin } from 'vite';
import { type ApiPluginOptions, contextFor } from './routes/context.ts';
import { registerRecordingRoutes } from './routes/recordings.ts';
import { registerStudioRoutes } from './routes/studio.ts';

export type { ApiPluginOptions };

// Every open-recording dev-server endpoint in one plugin. Each file under
// `routes/` leads with a comment-block manifest of the endpoints it owns.
export function apiPlugin(opts: ApiPluginOptions): Plugin {
  return {
    name: 'open-recording:api',
    apply: 'serve',
    configureServer(server) {
      const ctx = contextFor(opts);
      registerStudioRoutes(server, ctx);
      registerRecordingRoutes(server, ctx);
    },
  };
}
