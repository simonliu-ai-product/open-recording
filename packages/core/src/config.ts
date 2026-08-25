export type TranscribeConfig = {
  /** whisper.cpp binary. Defaults to `whisper-cli`, then `whisper-cpp`, on PATH. */
  bin?: string;
  /** Path to a ggml model, absolute or relative to the workspace. Defaults to the largest one found in the usual caches. */
  model?: string;
  /** BCP-47-ish code whisper.cpp understands, or `auto`. Defaults to `auto`. */
  language?: string;
  /** Passed through as `-t`. Defaults to whisper.cpp's own default. */
  threads?: number;
  /** Extra whisper.cpp flags, appended last. */
  extraArgs?: string[];
  /** ffmpeg binary used to make the 16 kHz mono WAV whisper.cpp needs. */
  ffmpeg?: string;
  /** Transcribe automatically when a recording stops. Defaults to false. */
  auto?: boolean;
  /**
   * Which Chinese script the transcript is written in. Whisper produces
   * Simplified whatever was spoken, so `traditional` is what a Taiwanese
   * workspace wants. Needs `opencc-js` installed. Defaults to `as-is`.
   */
  script?: 'traditional' | 'simplified' | 'as-is';
  /**
   * Initial prompt for whisper — useful for proper nouns it keeps mishearing.
   * Note that prompting also pushes it towards one long segment, losing the
   * per-line timestamps.
   */
  prompt?: string;
};

export type OpenRecordingConfig = {
  base?: string;
  /** Where recordings are stored, relative to the workspace root. Defaults to `recordings`. */
  recordingsDir?: string;
  port?: number;
  allowedHosts?: string[] | true;
  /**
   * MediaRecorder timeslice. Each slice is uploaded as it lands, so a crashed
   * tab costs at most this much audio. Defaults to 5000.
   */
  chunkMs?: number;
  /** Studios stop themselves at this length so a forgotten session can't fill the disk. Defaults to 2h. */
  maxDurationMs?: number;
  transcribe?: TranscribeConfig;
};
