---
name: transcribe-and-summarize
description: Transcribe a recording with whisper.cpp, fix misheard terms or speaker labels, and write structured notes.
---

# Transcribe and Summarize

1. Check `current_recording` or `list_recordings` to find the target recording `id`.
2. If `transcribed` is false, call `transcribe_recording` (pass `vocabulary` for product names, acronyms, and proper nouns). If it fails with 503, call `transcription_environment` and tell the user what `open-recording doctor` needs.
3. Call `read_transcript` (`view: 'segments'` or `'markdown'`) to read the timestamped lines.
4. Use `edit_transcript_segment` to tag `speaker` names, star key quotes (`starred: true`), or fix misheard proper nouns so Markdown, SRT, and VTT subtitles stay in sync.
5. Call `write_notes` with a structured summary (`## Summary`, `## Decisions`, `## Action Items`) citing `MM:SS` timestamps.
