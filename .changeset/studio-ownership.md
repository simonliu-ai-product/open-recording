---
"@open-recording/core": patch
---

Give a recording to the tab that is actually holding a microphone.

Ownership went to the longest-connected studio, so a tab left open in the background took the session instead of the one in front of you. Microphone permission is remembered per origin, so that tab armed itself silently, acknowledged the start, and then — throttled — produced no audio and never confirmed the stop, leaving an empty recording and a recorder that looked stuck.

Studios now claim the microphone when they take one, and the freshest claim owns the session. A session that is acknowledged but sends no audio ends by itself with that reason rather than hanging, and the sidebar says how many studio tabs are open.
