import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: 'esm',
  target: 'node18',
  platform: 'node',
  fixedExtension: false,
  clean: true,
  dts: true,
  shims: false,
  external: ['@open-recording/core'],
});
