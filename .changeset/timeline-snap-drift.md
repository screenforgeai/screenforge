---
'screenforge': patch
---

Fix clips drifting away from the cursor while dragging or resizing them on the timeline. Each time a clip snapped to another clip's edge or the playhead it kept the snap offset, so after a few edges the clip sat well ahead of or behind the cursor and moved in jumps. Clips still snap to nearby edges, then follow the cursor exactly once you move past.
