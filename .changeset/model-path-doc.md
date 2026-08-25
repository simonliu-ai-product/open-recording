---
"@open-recording/core": patch
---

Describe `transcribe.model` as it behaves. The published types said the path had to be absolute and that a discovered model was the first one found; a relative path is resolved against the workspace, and when several models are present the largest wins.
