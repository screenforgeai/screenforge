---
'screenforge': patch
---

Recording is more reliable on multi-monitor setups. On Windows the cursor now lines up on a monitor whose scale differs from another monitor's. Area recordings always capture the display the area was drawn on, and crop with that display's scale even if the main display changes. If the display being recorded is unplugged, the recording stops, keeps what was captured, and says why. The microphone menu now says when system audio can't be recorded (Linux, and macOS before 13), so it isn't silently missing.
