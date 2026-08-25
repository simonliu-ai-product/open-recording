# @open-recording/mcp

## 0.2.0

### Minor Changes

- [#7](https://github.com/simonliu-ai-product/open-recording/pull/7) [`01b4ac0`](https://github.com/simonliu-ai-product/open-recording/commit/01b4ac0fa3e5642058c3f0c45dd68ca5901ad348) Thanks [@LiuYuWei](https://github.com/LiuYuWei)! - Finish the line from recording to a usable transcript.
  
  - **Downloads.** The audio or video, the SRT, the VTT and the Markdown all download from a recording's page, named after the recording rather than after their slot in its directory. A recording that lives only in a folder on disk is no use once the subtitles need to be somewhere else.
  - **`transcribe.auto` now does what it says.** The setting was declared and nothing read it. Whisper starts when a recording stops — after the stop is answered, not inside it, because a long recording would time the caller out — and the list shows which recordings are still being transcribed.
  - **Pick the microphone.** The source menu lists the inputs the browser offers. A virtual device appears there like any other, which is how a workspace records what the machine is playing rather than what the room is saying.
  - **Correct a transcript line.** Whisper mishears names; re-running it produces the same mistake. A line is editable on the page and through the new `edit_transcript` tool, and the Markdown, SRT and VTT are rewritten with it.

- [`d37f66f`](https://github.com/simonliu-ai-product/open-recording/commit/d37f66f934ab5e06b8ac68ed2f71e0226dcabd5e) - Initial release: browser recording studio an agent can drive over MCP, with local whisper.cpp transcription.

- [`28e9884`](https://github.com/simonliu-ai-product/open-recording/commit/28e9884f6a4407d8ecfd13a385033ecb69e40412) - Pause and resume a recording, and fixes that stopped the browser studio recording at all.
  
  - **`pause_recording` / `resume_recording`**, in the studio and over MCP. A real `MediaRecorder.pause()`: one recording, one file, with the paused span simply absent from it and the clock stopping with it. Stop works straight from paused.
  - **Fixed: the studio's acknowledgements were refused.** They were posted without a body, so they carried no `content-type` and every mutating endpoint answered 415 — the server never learned that MediaRecorder had started, and `start_recording` always timed out with "the studio did not start recording". Recording from a browser could not work.
  - **Fixed: a session belongs to one studio.** `start` was broadcast to every connected page, so two open tabs each recorded and each appended to the same file, interleaving two WebM streams into one unplayable one.
  - **Fixed: the record button ignored the paused state**, offering to start a second recording while one was open.
  - **Fixed: closing the tab that holds the microphone left the recorder wedged** as `recording` forever, refusing every later start. The session now ends with the page, and the partial recording is finalized on the next start.

- [`369f061`](https://github.com/simonliu-ai-product/open-recording/commit/369f06158627b1e5cfe3bdac355eb7f23d929929) - Record a browser tab, and subtitle what was said.
  
  - **Record a tab** takes a tab's picture and, when the person ticks *Also share tab audio*, its sound — one `screen.webm`, driven by the same start / pause / stop as a microphone recording. Picking the surface stays a person's job because Chrome will not let a script choose one; once picked, an agent drives it.
  - On macOS, Chrome shares audio for a tab only, never a window or the whole screen. A silent share still records the picture, and the studio says so rather than letting you discover it in an empty transcript.
  - Transcribing now writes `transcript.srt` and `transcript.vtt` as well, and a screen recording plays with its subtitles loaded. `read_subtitles` returns either format over MCP.

### Patch Changes

- Updated dependencies [[`f4001c1`](https://github.com/simonliu-ai-product/open-recording/commit/f4001c15a766f29559cacf3c3da00e9cfbce947f), [`01b4ac0`](https://github.com/simonliu-ai-product/open-recording/commit/01b4ac0fa3e5642058c3f0c45dd68ca5901ad348), [`d37f66f`](https://github.com/simonliu-ai-product/open-recording/commit/d37f66f934ab5e06b8ac68ed2f71e0226dcabd5e), [`5198c7d`](https://github.com/simonliu-ai-product/open-recording/commit/5198c7d3fc5d92f73bc1d8e220f12a8a31ee55b7), [`107be18`](https://github.com/simonliu-ai-product/open-recording/commit/107be18af37884226a9d08bd134d14eef0611526), [`28e9884`](https://github.com/simonliu-ai-product/open-recording/commit/28e9884f6a4407d8ecfd13a385033ecb69e40412), [`9503bb1`](https://github.com/simonliu-ai-product/open-recording/commit/9503bb17e8df57c20b4d7f526c11f8292f105cdc), [`80edb81`](https://github.com/simonliu-ai-product/open-recording/commit/80edb813a93ba90295d67546d1611eb38dfe0c04), [`369f061`](https://github.com/simonliu-ai-product/open-recording/commit/369f06158627b1e5cfe3bdac355eb7f23d929929), [`85e74b3`](https://github.com/simonliu-ai-product/open-recording/commit/85e74b3a23b12c2234c2908a6cb41ab704c28410), [`8eabcc7`](https://github.com/simonliu-ai-product/open-recording/commit/8eabcc79d98771855a58a29cc88ed91ebb666c70), [`45759b7`](https://github.com/simonliu-ai-product/open-recording/commit/45759b755e203aefaa3120cd3559a1aff77258fc)]:
  - @open-recording/core@0.2.0
