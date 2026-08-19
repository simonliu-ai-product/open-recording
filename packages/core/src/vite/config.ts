import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { InlineConfig } from 'vite';
import type { OpenRecordingConfig } from '../config.ts';
import { apiPlugin } from './api-plugin.ts';
import { mcpPlugin } from './mcp-plugin.ts';
import { loadUserConfig, type StudioPluginOptions, studioPlugin } from './studio-plugin.ts';

function findPackageRoot(fromFile: string): string {
  let dir = path.dirname(fromFile);
  while (dir !== path.dirname(dir)) {
    if (existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error(`Could not find package.json walking up from ${fromFile}`);
}

const PKG_ROOT = findPackageRoot(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(PKG_ROOT, 'src', 'app');

function readCoreVersion(): string {
  try {
    const raw = readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8');
    return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const CORE_VERSION = readCoreVersion();

export type CreateViteConfigOptions = {
  userCwd: string;
  /** Mount the MCP endpoint (requires `@open-recording/mcp`). */
  mcp?: boolean;
  config?: OpenRecordingConfig;
};

export async function createViteConfig(opts: CreateViteConfigOptions): Promise<InlineConfig> {
  const userCwd = path.resolve(opts.userCwd);
  const config = opts.config ?? (await loadUserConfig(userCwd));
  const recordingsAbs = path.resolve(userCwd, config.recordingsDir ?? 'recordings');
  const pluginOpts: StudioPluginOptions = { userCwd, config, coreVersion: CORE_VERSION };

  return {
    base: config.base ?? '/',
    root: APP_ROOT,
    configFile: false,
    envDir: userCwd,
    plugins: [
      react(),
      tailwindcss(),
      studioPlugin(pluginOpts),
      apiPlugin({ userCwd, coreVersion: CORE_VERSION, config }),
      ...(opts.mcp ? [mcpPlugin({ userCwd, coreVersion: CORE_VERSION, config })] : []),
    ],
    resolve: {
      alias: { '@': APP_ROOT },
    },
    optimizeDeps: {
      entries: [path.join(APP_ROOT, 'main.tsx')],
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'react-router-dom',
        'next-themes',
        'lucide-react',
        'clsx',
        'tailwind-merge',
      ],
      // The app source ships inside node_modules/@open-recording/core/src/app,
      // so Vite's dep scanner traverses it as a third-party dep and tries to
      // bundle the virtual config import. Mark it external.
      rolldownOptions: {
        plugins: [
          {
            name: 'open-recording:virtual-externals',
            resolveId(id: string) {
              if (id.startsWith('virtual:open-recording/')) return { id, external: true };
              return null;
            },
          },
        ],
      },
    },
    server: {
      port: config.port ?? 5274,
      ...(config.allowedHosts !== undefined ? { allowedHosts: config.allowedHosts } : {}),
      fs: { allow: [APP_ROOT, userCwd, recordingsAbs] },
    },
  };
}

export { APP_ROOT };
