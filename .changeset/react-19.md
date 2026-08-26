---
"@open-recording/core": patch
---

Move the studio to React 19. Nothing in the app needed changing — the dependency, its types and `react-dom` all move together, which is the part that matters: React 19 with react-dom 18 does not render at all.
