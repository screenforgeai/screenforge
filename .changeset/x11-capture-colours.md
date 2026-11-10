---
'screenforge': patch
---

Linux (X11) recordings keep their on-screen colours. The capture used FFmpeg's default BT.601 colour conversion without saying so, while the editor and export read it as BT.709, so reds, oranges and blues were shifted in the preview and in exported videos.
