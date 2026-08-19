import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ApiContext, makeContext } from '../ops/context.ts';
import { loadUserConfig } from '../vite/studio-plugin.ts';

async function coreVersion(): Promise<string> {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const raw = await readFile(path.resolve(here, '..', '..', 'package.json'), 'utf8');
    return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** The same context the dev API and the MCP server run on, for commands that call `ops/`. */
export async function cliContext(userCwd = process.cwd()): Promise<ApiContext> {
  return makeContext({
    userCwd,
    coreVersion: await coreVersion(),
    config: await loadUserConfig(userCwd),
  });
}
