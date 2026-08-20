import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type Manifest = {
  exports?: Record<string, unknown>;
  module?: string;
  main?: string;
};

function entryFromExports(exports: Record<string, unknown> | undefined): string | null {
  const root = exports?.['.'] ?? exports;
  if (typeof root === 'string') return root;
  if (!root || typeof root !== 'object') return null;
  const conditions = root as Record<string, unknown>;
  for (const key of ['import', 'module', 'default', 'node']) {
    const value = conditions[key];
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
      const nested = entryFromExports({ '.': value } as Record<string, unknown>);
      if (nested) return nested;
    }
  }
  return null;
}

/**
 * Finds a package's ESM entry by walking `node_modules` up from the user's
 * workspace. Node's own resolver is not used for optional packages like this:
 * they belong to whoever opted into the feature rather than to core, and under
 * pnpm's strict layout core cannot see a sibling it does not depend on.
 */
export function resolveEsmEntry(userCwd: string, name: string): string | null {
  let dir = path.resolve(userCwd);
  for (;;) {
    const manifest = path.join(dir, 'node_modules', name, 'package.json');
    if (existsSync(manifest)) {
      try {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as Manifest;
        const entry = entryFromExports(pkg.exports) ?? pkg.module ?? pkg.main;
        return entry ? path.join(path.dirname(manifest), entry) : null;
      } catch {
        return null;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Imports an optional package from the user's workspace, or null when it is absent. */
export async function importOptional<T>(userCwd: string, name: string): Promise<T | null> {
  const entry = resolveEsmEntry(userCwd, name);
  try {
    return (await import(entry ? pathToFileURL(entry).href : name)) as T;
  } catch {
    return null;
  }
}
