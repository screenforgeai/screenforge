---
'screenforge': patch
---

On Linux with Wayland, Display and Area recordings now show the drawn cursor in your chosen style, following your pointer, with the system pointer kept out of the video so only one cursor shows. You still pick the screen in the system share dialog. If Screenforge can't record the screen this way on your desktop (its Wayland recorder is missing or can't run, or the desktop's screen sharing can't keep the pointer apart), recordings work as before, with the system pointer and no drawn cursor. Clicks aren't recorded on Wayland yet, and Window recordings work as before.
