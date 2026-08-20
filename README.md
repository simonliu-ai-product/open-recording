# open-recording

Record in the browser. Transcribe locally. Let an agent drive both.

`open-recording` gives an AI agent a real record button: it presses start, a studio page in your browser captures the microphone, and when it presses stop the audio lands on your disk and gets transcribed by whisper.cpp — no audio leaves the machine.

Built the same way as [open-doc](https://github.com/simonliu-ai-product/open-doc) and open-slide: a Vite dev server, one `ops` layer, and an MCP endpoint mounted on it.

## Quick start

```bash
pnpm install
pnpm dev:demo            # studio at http://localhost:5274, MCP at /mcp
```

Open the studio in a browser and press **Arm microphone** in the sidebar footer, once. The page keeps the permission, so an agent can start a recording without waiting on a prompt.

For transcription:

```bash
brew install whisper-cpp ffmpeg
mkdir -p models && curl -L -o models/ggml-large-v3-turbo.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin
npx open-recording doctor   # confirms ffmpeg, the binary, and the model
```

`doctor` prints the fix for anything missing. Recording works without any of it; only transcription is refused.

## How an agent uses it

Point your agent at the MCP endpoint (`http://localhost:5274/mcp`), then:

| Tool | What it does |
| --- | --- |
| `recorder_status` | Is anything recording, and is a studio connected to record through |
| `start_recording` | Press record. Returns only once the browser confirms the mic is live |
| `stop_recording` | Stop and finalize; pass `transcribe: true` to run whisper right away |
| `cancel_recording` | Stop and throw the audio away |
| `transcribe_recording` | Run whisper.cpp over a recording |
| `read_transcript` | Timestamped Markdown, plain text, or timed segments |
| `search_transcripts` | Substring search across every transcript, with millisecond offsets |
| `write_notes` / `read_notes` | Park a summary or action items beside the audio |
| `list_recordings` / `read_recording` / `rename_recording` / `tag_recording` / `delete_recording` | Housekeeping |
| `transcription_environment` | What whisper/ffmpeg/model resolved — read this on a 503 |

A typical run: `start_recording` → the meeting happens → `stop_recording {transcribe: true}` → `read_transcript` → `write_notes` with the summary.

`start_recording` waits for the studio page to acknowledge that `MediaRecorder` is actually running. If the tab is closed or the mic is blocked, the agent gets a refusal that says so — never a success for a recording nobody is making.

## CLI

```bash
open-recording dev --mcp        # studio + MCP endpoint
open-recording list             # every recording
open-recording show <id>        # print its transcript
open-recording transcribe --all # catch up on anything untranscribed
open-recording search "排程"     # grep the transcripts
open-recording doctor           # check the local toolchain
open-recording rm <id>          # delete
```

## What lands on disk

```
recordings/
  20260819-141530-weekly-sync/
    meta.json        title, length, size, tags, transcription details
    audio.webm       what the browser captured
    transcript.json  timed segments
    transcript.md    timestamped Markdown — what an agent reads back
    notes.md         whatever the agent wrote there
```

No database, no index. The filesystem is the truth, and ids sort chronologically.

## Chinese transcripts come out Traditional if you ask

Whisper writes Simplified Chinese whatever was spoken — its training data is
overwhelmingly Simplified — so a meeting in Taipei is transcribed into a script
nobody in the room writes. Set the script and install the converter:

```bash
pnpm add -D opencc-js
```

```ts
transcribe: { script: 'traditional' }
```

Conversion is phrase-aware (`软件` becomes `軟體`, not `軟件`) and happens after
whisper, so the per-line timestamps survive. Prompting whisper towards
Traditional instead does work, but it also makes it return the whole recording
as one segment — which is why this converts rather than prompts.

Transcription is refused, rather than silently written in the wrong script, if
`script` is set and the converter is missing.

## Configuration

`open-recording.config.ts` in your workspace:

```ts
import type { OpenRecordingConfig } from '@open-recording/core';

export default {
  recordingsDir: 'recordings',
  port: 5274,
  chunkMs: 5000,          // upload granularity; a crashed tab costs one slice
  maxDurationMs: 7200000, // studios stop themselves here
  transcribe: {
    language: 'auto',     // or 'zh', 'en', …
    model: 'models/ggml-large-v3-turbo.bin',
    threads: 8,
  },
} satisfies OpenRecordingConfig;
```

## Packages

| Package | Role |
| --- | --- |
| `@open-recording/core` | Studio runtime, dev API, recorder state machine, whisper.cpp transcription, CLI |
| `@open-recording/mcp` | MCP server over the same `ops` layer |

## Credits

The architecture — the `ops` layer shared by the dev API and an MCP server, the Vite-plugin dev server, the scaffolding of the whole monorepo — follows [open-slide](https://github.com/1weiho/open-slide) by [@1weiho](https://github.com/1weiho), by way of [open-doc](https://github.com/simonliu-ai-product/open-doc). The studio's two-pane shell and its design language — the neutral zero-chroma ramp, the single vermillion accent, the `.eyebrow` and `.folio` type styles — are taken from open-slide directly.

## License

MIT
