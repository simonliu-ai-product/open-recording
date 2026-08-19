---
"@open-recording/core": minor
"@open-recording/mcp": minor
---

Pause and resume a recording, and fixes that stopped the browser studio recording at all.

- **`pause_recording` / `resume_recording`**, in the studio and over MCP. A real `MediaRecorder.pause()`: one recording, one file, with the paused span simply absent from it and the clock stopping with it. Stop works straight from paused.
- **Fixed: the studio's acknowledgements were refused.** They were posted without a body, so they carried no `content-type` and every mutating endpoint answered 415 — the server never learned that MediaRecorder had started, and `start_recording` always timed out with "the studio did not start recording". Recording from a browser could not work.
- **Fixed: a session belongs to one studio.** `start` was broadcast to every connected page, so two open tabs each recorded and each appended to the same file, interleaving two WebM streams into one unplayable one.
- **Fixed: the record button ignored the paused state**, offering to start a second recording while one was open.
- **Fixed: closing the tab that holds the microphone left the recorder wedged** as `recording` forever, refusing every later start. The session now ends with the page, and the partial recording is finalized on the next start.
