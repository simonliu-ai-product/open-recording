import type { OpenRecordingConfig } from '@open-recording/core';

const config: OpenRecordingConfig = {
  // Short slices so a test does not have to wait five seconds for the first one.
  chunkMs: 500,
};

export default config;
