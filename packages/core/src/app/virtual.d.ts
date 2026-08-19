declare module 'virtual:open-recording/config' {
  const config: {
    recordingsDir: string;
    chunkMs: number;
    maxDurationMs: number;
    version: string;
  };
  export default config;
}
