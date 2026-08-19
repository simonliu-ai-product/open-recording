import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import chalk from 'chalk';
import type { Plugin } from 'vite';
import type { ApiPluginOptions } from './routes/context.ts';

type Middleware = (req: unknown, res: unknown, next: (err?: unknown) => void) => void;

/**
 * Finds a package's ESM entry by walking `node_modules` up from the user's
 * workspace. Node's own resolver is not used here for two reasons: the package
 * belongs to whoever opted into the endpoint rather than to core, and
 * `require.resolve` cannot read an exports map that only declares ESM
 * conditions.
 */
function resolveEsmEntry(userCwd: string, name: string): string | null {
  let dir = path.resolve(userCwd);
  for (;;) {
    const manifest = path.join(dir, 'node_modules', name, 'package.json');
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
        exports?: { '.'?: { import?: string } };
        module?: string;
        main?: string;
      };
      const entry = pkg.exports?.['.']?.import ?? pkg.module ?? pkg.main;
      return entry ? path.join(path.dirname(manifest), entry) : null;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export type McpPluginOptions = ApiPluginOptions & {
  /** Path the MCP endpoint is served on. */
  endpoint?: string;
};

/**
 * Mounts `@open-recording/mcp` on the dev server. This is not just convenience:
 * the recorder state machine lives in this process, so the tools that press
 * record must run here to reach the studio page over its open SSE stream.
 *
 * The package is imported dynamically and is *not* a dependency of core — the
 * MCP SDK is sizeable and only matters to people wiring up agents. A missing
 * install is reported, never fatal.
 */
export function mcpPlugin(opts: McpPluginOptions): Plugin {
  const endpoint = opts.endpoint ?? '/mcp';
  return {
    name: 'open-recording:mcp',
    apply: 'serve',
    async configureServer(server) {
      let mod: { createOpenRecordingMcpMiddleware: (o: unknown) => Middleware };
      try {
        // The specifier stays a variable either way, so core takes no
        // build-time dependency on a package whose peer is core.
        const specifier = '@open-recording/mcp';
        const entry = resolveEsmEntry(opts.userCwd, specifier);
        mod = (await import(entry ? pathToFileURL(entry).href : specifier)) as typeof mod;
      } catch {
        server.config.logger.warn(
          chalk.yellow(
            '  MCP endpoint disabled — run `pnpm add -D @open-recording/mcp` to enable it.\n',
          ),
        );
        return;
      }

      let middleware: Middleware | undefined;
      server.middlewares.use(endpoint, (req, res, next) => {
        middleware ??= mod.createOpenRecordingMcpMiddleware({
          userCwd: opts.userCwd,
          version: opts.coreVersion,
          config: opts.config,
        });
        return middleware(req, res, next);
      });

      server.httpServer?.once('listening', () => {
        const address = server.httpServer?.address();
        const port = typeof address === 'object' && address ? address.port : '';
        server.config.logger.info(
          `  ${chalk.green('➜')}  ${chalk.bold('MCP')}:     ${chalk.cyan(`http://localhost:${port}${endpoint}`)}`,
        );
      });
    },
  };
}
