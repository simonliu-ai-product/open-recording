---
"@open-recording/core": patch
---

Tag a recording from the page, and sort the table by clicking a column.

Tags could only be set by an agent — `start_recording` or `tag_recording` — which left the sidebar's tag list unbuildable by the person looking at it. A recording's page now edits them directly.

Sorting became a field and a direction rather than four fixed orderings, so a table heading and the sort menu drive the same state and cannot disagree about how the list is ordered.
