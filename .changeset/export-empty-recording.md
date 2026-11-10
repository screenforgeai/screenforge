---
'screenforge': patch
---

A recording that captured nothing (for example, when macOS never sent a frame of the window) now stops with "Nothing was captured" instead of opening as a blank recording that later failed to export with "416 Requested Range Not Satisfiable". Exporting a recording whose video file is empty or missing now says so too, and recording and export errors no longer start with "Error invoking remote method".
