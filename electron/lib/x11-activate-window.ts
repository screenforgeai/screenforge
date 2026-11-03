/**
 * Activates (focuses + raises) an X11 window by sending the EWMH
 * _NET_ACTIVE_WINDOW client message to the window manager.
 *
 * Neither wmctrl nor xdotool can be assumed installed, so the message is sent
 * through python3 + ctypes + libX11 — both present on effectively every X11
 * desktop. Source indication 2 ("pager") makes WMs like Mutter treat the
 * request as user-initiated and actually switch focus.
 */
import { execFile } from 'node:child_process';
import log from './logger';

const ACTIVATE_TIMEOUT_MS = 2500;

const ACTIVATE_SCRIPT = `
import ctypes, sys
window_id = int(sys.argv[1])
x11 = ctypes.CDLL("libX11.so.6")
x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XDefaultRootWindow.restype = ctypes.c_ulong
display = x11.XOpenDisplay(None)
if not display:
    sys.exit(1)
d = ctypes.c_void_p(display)
root = x11.XDefaultRootWindow(d)
atom = x11.XInternAtom(d, b"_NET_ACTIVE_WINDOW", 0)

class XClientMessageEvent(ctypes.Structure):
    _fields_ = [
        ("type", ctypes.c_int),
        ("serial", ctypes.c_ulong),
        ("send_event", ctypes.c_int),
        ("display", ctypes.c_void_p),
        ("window", ctypes.c_ulong),
        ("message_type", ctypes.c_ulong),
        ("format", ctypes.c_int),
        ("data", ctypes.c_ulong * 5),
        ("pad", ctypes.c_ulong * 24),  # XSendEvent copies sizeof(XEvent)
    ]

event = XClientMessageEvent()
event.type = 33  # ClientMessage
event.window = window_id
event.message_type = atom
event.format = 32
event.data[0] = 2  # source indication: pager
event.data[1] = 0  # timestamp: CurrentTime
mask = (1 << 20) | (1 << 19)  # SubstructureRedirect | SubstructureNotify
status = x11.XSendEvent(d, ctypes.c_ulong(root), 0, ctypes.c_long(mask), ctypes.byref(event))
x11.XFlush(d)
x11.XCloseDisplay(d)
sys.exit(0 if status else 1)
`;

export function activateX11Window(windowId: number): Promise<void> {
  return new Promise((resolve) => {
    execFile(
      'python3',
      ['-c', ACTIVATE_SCRIPT, String(windowId)],
      { timeout: ACTIVATE_TIMEOUT_MS },
      (error) => {
        if (error) {
          log.warn('[x11-activate] could not activate window:', error.message);
        }
        resolve();
      },
    );
  });
}
