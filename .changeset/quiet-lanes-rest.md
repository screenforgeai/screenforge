---
'screenforge': patch
---

Faster exports: adding the first text, zoom or mask clip to a video, or removing the last one, no longer makes Screenforge prepare the whole export again in the background. Only the few seconds around that clip are redone.
