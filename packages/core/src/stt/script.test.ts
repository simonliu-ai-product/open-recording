import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  loadConverter,
  ScriptConversionUnavailableError,
  scriptConversionAvailable,
} from './script.ts';

// The demo workspace is where opencc-js is installed; core never depends on it.
const here = path.dirname(fileURLToPath(import.meta.url));
const WITH_OPENCC = path.resolve(here, '..', '..', '..', '..', 'apps', 'demo');
const WITHOUT_OPENCC = path.resolve(here, '..', '..', 'e2e', 'fixture');

describe('loadConverter', () => {
  it('converts to Taiwanese Traditional, vocabulary included', async () => {
    const convert = await loadConverter(WITH_OPENCC, 'traditional');
    if (!convert) throw new Error('expected a converter');

    expect(convert('欢迎来到本场演讲')).toBe('歡迎來到本場演講');
    // `twp` carries the vocabulary, not only the characters.
    expect(convert('软件')).toBe('軟體');
    // A character that maps two ways is resolved by the phrase around it.
    expect(convert('头发')).toBe('頭髮');
    expect(convert('发现')).toBe('發現');
  });

  it('converts the other way when asked', async () => {
    const convert = await loadConverter(WITH_OPENCC, 'simplified');
    if (!convert) throw new Error('expected a converter');
    expect(convert('歡迎來到')).toBe('欢迎来到');
  });

  it('leaves the transcript alone when no script is set', async () => {
    expect(await loadConverter(WITH_OPENCC, 'as-is')).toBeNull();
  });

  it('refuses rather than quietly writing the wrong script', async () => {
    await expect(loadConverter(WITHOUT_OPENCC, 'traditional')).rejects.toBeInstanceOf(
      ScriptConversionUnavailableError,
    );
  });
});

describe('scriptConversionAvailable', () => {
  it('reports what the workspace can actually do', async () => {
    expect(await scriptConversionAvailable(WITH_OPENCC)).toBe(true);
    expect(await scriptConversionAvailable(WITHOUT_OPENCC)).toBe(false);
  });
});
