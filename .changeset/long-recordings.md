---
'screenforge': patch
---

Long recordings are much easier to finish and edit. The editor no longer gets stuck on "Processing" after a long take. Microphone, camera and Wayland screen recordings are written to disk while you record instead of being held in memory, and saving a long take is no longer cut off early, which used to drop the microphone. Opening a long recording no longer freezes the editor while it looks for zooms, and its waveform no longer risks crashing the editor. Autosave no longer copies the whole video again every few seconds, and undo no longer brings back zooms you deleted. Exports of long recordings also start sooner.
