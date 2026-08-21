import type { OpenRecordingConfig } from '@open-recording/core';

const config: OpenRecordingConfig = {
  transcribe: {
    // `auto` guesses per recording; pin it when a workspace is single-language.
    language: 'auto',
    // Whisper writes Simplified whatever was spoken; this is a Taiwanese workspace.
    script: 'traditional',
    // Whisper starts as soon as a recording stops.
    auto: true,
  },
};

export default config;
