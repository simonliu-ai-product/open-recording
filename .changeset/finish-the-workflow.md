---
"@open-recording/core": minor
"@open-recording/mcp": minor
---

Finish the line from recording to a usable transcript.

- **Downloads.** The audio or video, the SRT, the VTT and the Markdown all download from a recording's page, named after the recording rather than after their slot in its directory. A recording that lives only in a folder on disk is no use once the subtitles need to be somewhere else.
- **`transcribe.auto` now does what it says.** The setting was declared and nothing read it. Whisper starts when a recording stops — after the stop is answered, not inside it, because a long recording would time the caller out — and the list shows which recordings are still being transcribed.
- **Pick the microphone.** The source menu lists the inputs the browser offers. A virtual device appears there like any other, which is how a workspace records what the machine is playing rather than what the room is saying.
- **Correct a transcript line.** Whisper mishears names; re-running it produces the same mistake. A line is editable on the page and through the new `edit_transcript` tool, and the Markdown, SRT and VTT are rewritten with it.
