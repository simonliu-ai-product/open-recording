import { describe, expect, it } from 'vitest';
import { DICTIONARIES, en, LOCALES } from './i18n';

describe('i18n dictionaries', () => {
  const keys = Object.keys(en);

  for (const locale of LOCALES) {
    it(`${locale.code} has every translation key with non-empty text`, () => {
      const dict = DICTIONARIES[locale.code];
      expect(Object.keys(dict).sort()).toEqual([...keys].sort());
      for (const k of keys) {
        expect(dict[k as keyof typeof en].trim().length).toBeGreaterThan(0);
      }
    });
  }
});
