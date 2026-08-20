---
"@open-recording/core": minor
---

Write Chinese transcripts in the script the room actually uses.

Whisper produces Simplified Chinese whatever was spoken, so a meeting in Taipei came back in a script nobody there writes. `transcribe.script: 'traditional'` converts the transcript with OpenCC — phrase-aware, so `软件` becomes `軟體` rather than `軟件`, and `头发` and `发现` resolve differently despite sharing a character.

Conversion happens after whisper, so the per-line timestamps survive. Prompting whisper towards Traditional instead does work, but it makes it return the whole recording as one segment and the timestamps are lost with it.

`opencc-js` is an optional install, resolved from your workspace. With `script` set and the converter missing, transcription is refused rather than quietly written in the wrong script, and `open-recording doctor` says so.
