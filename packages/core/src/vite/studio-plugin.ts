import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadConfigFromFile, type Plugin } from 'vite';
import type { OpenRecordingConfig } from '../config.ts';
import { DEFAULT_CHUNK_MS, DEFAULT_MAX_DURATION_MS } from '../ops/context.ts';

export const CONFIG_FILE = 'open-recording.config.ts';

const VIRTUAL_CONFIG = 'virtual:open-recording/config';

export async function loadUserConfig(userCwd: string): Promise<OpenRecordingConfig> {
  const file = path.join(userCwd, CONFIG_FILE);
  if (!existsSync(file)) return {};
  const loaded = await loadConfigFromFile(
    { command: 'serve', mode: 'development' },
    file,
    userCwd,
    'silent',
  );
  return (loaded?.config ?? {}) as OpenRecordingConfig;
}

export type StudioPluginOptions = {
  userCwd: string;
  config: OpenRecordingConfig;
  coreVersion: string;
};

/**
 * Publishes the settings the studio page needs to hold a microphone correctly —
 * chiefly the slice length, which the server and the page must agree on for
 * uploaded chunks to line up with the duration it reports.
 */
export function studioPlugin(opts: StudioPluginOptions): Plugin {
  const resolved = `\0${VIRTUAL_CONFIG}`;
  return {
    name: 'open-recording:studio',
    resolveId(id) {
      if (id === VIRTUAL_CONFIG) return resolved;
      return null;
    },
    load(id) {
      if (id !== resolved) return null;
      const payload = {
        recordingsDir: opts.config.recordingsDir ?? 'recordings',
        chunkMs: opts.config.chunkMs ?? DEFAULT_CHUNK_MS,
        maxDurationMs: opts.config.maxDurationMs ?? DEFAULT_MAX_DURATION_MS,
        version: opts.coreVersion,
      };
      return `export default ${JSON.stringify(payload)};`;
    },
  };
}
