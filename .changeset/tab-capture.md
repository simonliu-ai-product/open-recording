---
"@open-recording/core": minor
"@open-recording/mcp": minor
---

Record a browser tab, and subtitle what was said.

- **Record a tab** takes a tab's picture and, when the person ticks *Also share tab audio*, its sound — one `screen.webm`, driven by the same start / pause / stop as a microphone recording. Picking the surface stays a person's job because Chrome will not let a script choose one; once picked, an agent drives it.
- On macOS, Chrome shares audio for a tab only, never a window or the whole screen. A silent share still records the picture, and the studio says so rather than letting you discover it in an empty transcript.
- Transcribing now writes `transcript.srt` and `transcript.vtt` as well, and a screen recording plays with its subtitles loaded. `read_subtitles` returns either format over MCP.
