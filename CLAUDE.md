# open-recording — Framework Repo Guide

You are working on the **open-recording framework** — the studio runtime, CLI, and MCP server that ship to npm.

## Layout

pnpm + Turbo monorepo.

| Path | Package | Role |
| --- | --- | --- |
| `packages/core` | `@open-recording/core` | Studio app (browser recorder, transcript viewer), Vite plugins, dev API, recorder state machine, whisper.cpp transcription, `open-recording` CLI. |
| `packages/mcp` | `@open-recording/mcp` | MCP server exposing the `ops` layer as tools over Streamable HTTP. Opt-in; mounted at `/mcp` by `open-recording dev --mcp`. |
| `apps/demo` | private | Local consumer of `@open-recording/core` via `workspace:*`. Dogfood target — `pnpm dev:demo`. |

Shared config: `biome.json`, `turbo.json`, `pnpm-workspace.yaml`, `vitest.config.ts`, `tsconfig` per package.

## Workflow

```bash
pnpm dev          # turbo: runs the demo studio against local core
pnpm build        # build all packages
pnpm typecheck    # tsc across the graph
pnpm check        # biome (format + lint + organize imports)
pnpm check:fix    # auto-fix what biome can
pnpm test         # vitest
```

Filter to one package: `pnpm core <script>` / `pnpm mcp <script>`.

Releases go through changesets: `pnpm changeset` on any PR touching `packages/*`, then CI opens the release PR and publishes on merge. Never bump versions or edit `CHANGELOG.md` by hand.

**After changing `packages/core/src`, rebuild it (`pnpm core build`) before testing the demo** — the demo runs the `open-recording` binary out of `dist`, not the source.

## Architecture notes

- **The browser holds the microphone; the server holds the state.** Node cannot open a mic here by design — capture is `getUserMedia` + `MediaRecorder` in a real tab. Everything else (the session, the files, the transcript) lives on the dev server. Any feature that needs audio must go through a connected studio page.
- **One state machine, reached two ways.** `recorder/hub.ts` is the only place a session exists. The dev API moves it for the studio page; `@open-recording/mcp` moves it for an agent. Both call `ops/`, so a person and an agent share one recorder — whoever presses stop, the other one sees it.
- **The hub lives on `globalThis`.** Two copies of core exist at runtime: the dev server imports `src/`, while the MCP package imports the built `dist/`. A hub split in two would let an agent open a session the browser never hears about, so the registry is stashed on `globalThis` keyed by workspace root. A new shared singleton must follow the same pattern.
- **`start_recording` is not fire-and-forget.** It arms the hub, broadcasts a start command, and *waits for the studio to acknowledge that MediaRecorder is running* before it returns. A page that is closed, backgrounded, or missing permission produces a 504 with that reason — never a success for a recording nobody is making.
- **Slices are appended, never buffered.** MediaRecorder emits a slice every `chunkMs`; each one is POSTed and appended to `audio.webm` in arrival order. Only the first slice carries the WebM header, so order is not negotiable — the studio chains its uploads instead of firing them in parallel. A crashed tab costs one slice, not the session.
- **The studio is a singleton outside React.** `app/lib/studio.ts` owns the EventSource, the MediaStream, and the MediaRecorder. React only subscribes. Putting any of it in a component would open a second event stream on StrictMode's double mount and drop a recording on remount.
- **Transcription is one shell-out, not a service.** `stt/whisper.ts` converts to 16 kHz mono WAV with ffmpeg (the only format whisper.cpp reads) and runs the binary with `-oj`. A missing binary or model is a `WhisperUnavailableError`, reported as 503 with the `doctor` command in the message — a setup problem, not a bad request.
- **Recordings are directories, not rows.** `recordings/<id>/` holds `meta.json`, `audio.webm`, `transcript.json`, `transcript.md`, `notes.md`. There is no database and no index; the filesystem is the truth. Ids lead with a sortable timestamp so a plain directory listing is in chronological order, and a CJK-only title yields an empty slug and falls back to the timestamp alone.
- **Every mutating dev endpoint is guarded.** `validateMutationRequest` runs first on anything that writes — these endpoints hold a microphone and write to the user's disk, so a page on another origin must not be able to drive them. The MCP handler validates Host and Origin for the same reason.
- **The studio borrows open-slide's shell.** Two panes: a fixed sidebar (wordmark, nav rows with zero-padded `.folio` counts, tag list, footer holding mic state and version) over a `--canvas` main pane with one `max-w-[1180px]` container. Neutral zero-chroma ramp, hairline borders, one vermillion `--brand` accent reserved for anything live. `.eyebrow` is the only section label and `.folio` the only numeric style — new UI uses them rather than inventing a third.
- **A card shows what was said, not a waveform.** The tile carries the opening words of the transcript (`preview` on the list payload). A drawn waveform would be decoration standing in for content, and a recording's content is its words.
- **Path safety is centralized.** `files/store.ts` owns id validation and the containment check. Never join a recording id onto a directory by hand.

## Hard rules

- **Biome must pass before commit.** Run `pnpm check` (or `pnpm check:fix`).
- Don't add dependencies casually. The `core` runtime ships to users; every dep inflates install size.
- **Never make the recorder silently succeed.** Anything that cannot actually capture audio must surface as a refusal with a reason a caller can act on. A tool that returns "ok" for a recording that is not happening is the worst bug this repo can ship.
- **Default to writing no comments.** Only add one when the WHY is non-obvious — a hidden constraint, a subtle invariant, a workaround for a specific bug. Don't explain WHAT the code does, don't write section-divider banners, don't leave commented-out code.
