---
name: search-archive
description: Search across all stored transcripts and recordings to answer questions with exact timestamp citations.
---

# Search Recording Archive

1. Call `search_transcripts` with focused keywords or speaker names. Each hit returns `id`, `title`, `start` (ms), `speaker`, and `text`.
2. For relevant recordings, call `read_transcript` and `read_notes` to gather surrounding context.
3. Always cite the recording title, `id`, and formatted timestamp (`MM:SS`) in your answer so the user can jump directly to `/r/<id>?t=<start>`.
