---
'screenforge': patch
---

Faster exports on Mac: each frame now comes back from the graphics card at less than half the size, so exports and the background preparation of an export take less time. Behind a setting that is off for now, exports can also skip full-frame smoothing and smooth only the edges that need it, which makes them faster still.
