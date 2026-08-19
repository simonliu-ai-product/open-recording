import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'e2e', 'fixture');

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: false,
  // One worker: every test drives the one recorder this workspace has.
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 45_000,
  use: {
    baseURL: 'http://localhost:5288',
    permissions: ['microphone'],
    launchOptions: {
      // A synthetic microphone, so the suite records real audio through the
      // real MediaRecorder without asking for anyone's actual microphone.
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },
  webServer: {
    command: 'node ../../bin.js dev --port 5288',
    cwd: fixture,
    url: 'http://localhost:5288',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
