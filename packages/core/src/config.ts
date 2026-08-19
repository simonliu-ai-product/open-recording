export type TranscribeConfig = {
  /** whisper.cpp binary. Defaults to `whisper-cli`, then `whisper-cpp`, on PATH. */
  bin?: string;
  /** Absolute path to a ggml model. Defaults to the first model found in the usual caches. */
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
