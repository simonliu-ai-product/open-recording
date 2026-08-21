---
"@open-recording/core": patch
---

A finished recording can be scrubbed.

MediaRecorder writes a live stream: no duration in the header and no index of where the clusters are, so a player had no timeline to drag along and seeking backwards was guesswork. Finalizing now rewrites the container — copying the streams, no re-encoding, hundredths of a second even for a long recording — which gives it both.

`open-recording repair --all` does the same for recordings made before this.
