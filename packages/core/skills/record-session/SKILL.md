---
name: record-session
description: Start, pause, mark highlights, and stop a browser recording session through open-recording MCP tools.
---

# Record a Session

1. Call `recorder_status` first to confirm a studio browser tab is connected (`studios > 0`) and `status` is `idle`.
2. Call `start_recording` with a descriptive `title` and optional `tags`. It returns once the browser confirms `MediaRecorder` is live.
3. While recording, call `mark_moment` with a `label` whenever an important decision, question, or action item happens so a timestamped bookmark lands on the recording.
4. Use `pause_recording` / `resume_recording` for breaks so the session stays a single recording file.
5. Call `stop_recording` (pass `transcribe: true` to run local whisper.cpp immediately) when the session ends.
