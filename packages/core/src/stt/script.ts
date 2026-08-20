import { importOptional } from '../files/resolve.ts';

export type ChineseScript = 'traditional' | 'simplified' | 'as-is';

/**
 * Whisper's Chinese comes out Simplified whatever the speaker said — its
 * training data is overwhelmingly Simplified — so a Taiwanese meeting is
 * transcribed into a script nobody in the room writes.
 *
 * Biasing the model with a Traditional initial prompt does work, but it also
 * makes whisper return the whole recording as one segment, which throws away
 * the timestamps that let a transcript point back at a moment in the audio.
 * Converting afterwards costs nothing and is the only approach that actually
 * guarantees the script, so that is what this does.
 */

type OpenCC = {
  Converter: (opts: { from: string; to: string }) => (text: string) => string;
};

export class ScriptConversionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScriptConversionUnavailableError';
  }
}

const INSTALL_HINT =
  'Converting the transcript needs OpenCC. Install it in this workspace:\n' +
  '  pnpm add -D opencc-js';

/**
 * `twp` rather than `tw`: it carries Taiwanese vocabulary as well as the
 * characters, so `软件` becomes `軟體` rather than `軟件`. Conversion is
 * phrase-aware, which a character table cannot be — `头发` and `发现` share a
 * character that maps two different ways.
 */
export async function loadConverter(
  userCwd: string,
  script: ChineseScript,
): Promise<((text: string) => string) | null> {
  if (script === 'as-is') return null;

  const opencc = await importOptional<OpenCC>(userCwd, 'opencc-js');
  if (!opencc?.Converter) throw new ScriptConversionUnavailableError(INSTALL_HINT);

  return script === 'traditional'
    ? opencc.Converter({ from: 'cn', to: 'twp' })
    : opencc.Converter({ from: 'tw', to: 'cn' });
}

export async function scriptConversionAvailable(userCwd: string): Promise<boolean> {
  const opencc = await importOptional<OpenCC>(userCwd, 'opencc-js');
  return typeof opencc?.Converter === 'function';
}
