import type { OpenRecordingConfig } from '@open-recording/core';

const config: OpenRecordingConfig = {
  transcribe: {
    // `auto` guesses per recording; pin it when a workspace is single-language.
    language: 'auto',
  },
};

export default config;
