/**
 * Wayland: what the next screen-share request asks the system dialog (xdg-desktop-portal) for.
 * Apps there cannot list other apps' windows, so a window is picked in that dialog: the toolbar
 * sets 'window' just before recording from its Window tab. Each request takes the kind and
 * resets it, so anything else asks for a screen as before.
 */
export type ShareKind = 'screen' | 'window';

let nextKind: ShareKind = 'screen';

export function setShareKind(kind: ShareKind): void {
  nextKind = kind === 'window' ? 'window' : 'screen';
}

export function takeShareKind(): ShareKind {
  const kind = nextKind;
  nextKind = 'screen';
  return kind;
}
