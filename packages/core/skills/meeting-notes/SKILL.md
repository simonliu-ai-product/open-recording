---
name: meeting-notes
description: Write or refine structured Markdown notes, bookmarks, and action items beside a recording.
---

# Meeting Notes

1. Call `current_recording` to see which recording the user has open in the studio and their current playhead position (`currentTimeMs`).
2. Call `read_recording` and `read_transcript` (`view: 'markdown'`) to inspect bookmarks (`meta.bookmarks`), starred segments (`★`), and speaker tags.
3. Draft concise Markdown notes organized into:
   - **TL;DR**: 2–3 sentences
   - **Key Moments**: bullet list with `MM:SS` timestamps matching bookmarks and starred lines
   - **Action Items**: `- [ ] Owner — task (MM:SS)`
4. Save via `write_notes` and optionally tag the recording with `tag_recording`.
