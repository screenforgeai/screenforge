/**
 * Text measuring and cutting for the bar, without a canvas: Inter 500's own
 * advance widths, so the browser preview, the video harness and the capture
 * exporter (an SVG composited in Node) all cut a long address at the same
 * character.
 */

/** Inter at weight 500, advance per character (U+0020–U+007E) in 1/1000 em. */
const INTER_500_ADVANCES = [
  267, 304, 494, 639, 646, 993, 653, 313, 369, 369, 521, 667, 303, 462, 303, 370, 646, 415, 616,
  627, 656, 603, 630, 571, 629, 630, 303, 315, 667, 667, 667, 527, 982, 709, 657, 733, 722, 603,
  589, 748, 745, 272, 575, 688, 565, 913, 756, 767, 642, 769, 648, 646, 653, 740, 709, 1003, 701,
  696, 641, 369, 370, 369, 477, 463, 337, 568, 618, 577, 618, 587, 379, 620, 602, 252, 252, 559,
  252, 888, 602, 604, 618, 618, 387, 539, 340, 602, 575, 829, 557, 575, 559, 440, 346, 440, 667,
];
const ELLIPSIS_ADVANCE = 910;
/** A Latin letter outside the table: about an average lowercase one. */
const OTHER_ADVANCE = 600;
/** CJK and other full-width characters take a whole em. */
const WIDE_ADVANCE = 1000;
/** Emoji come from a fallback color font, wider than an em; better too wide than spilling over. */
const EMOJI_ADVANCE = 1300;
/** Joiners, variation selectors and combining marks draw nothing of their own width. */
const ZERO_WIDTH = /\p{M}|[\u200B-\u200D\u2060]|[\u{E0020}-\u{E007F}]/u;
const EMOJI = /\p{Emoji_Presentation}|\p{Regional_Indicator}/u;

export const ELLIPSIS = '…';

function advance(char: string): number {
  const code = char.codePointAt(0) ?? 32;
  if (code >= 32 && code <= 126) {
    return INTER_500_ADVANCES[code - 32] ?? OTHER_ADVANCE;
  }
  if (char === ELLIPSIS) {
    return ELLIPSIS_ADVANCE;
  }
  if (ZERO_WIDTH.test(char)) {
    return 0;
  }
  if (EMOJI.test(char)) {
    // A pair of regional indicators is one flag.
    return /\p{Regional_Indicator}/u.test(char) ? EMOJI_ADVANCE / 2 : EMOJI_ADVANCE;
  }
  if (code >= 0x1100 && /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{20000}-\u{3FFFD}]/u.test(char)) {
    return WIDE_ADVANCE;
  }
  return OTHER_ADVANCE;
}

/** How wide `text` draws in Inter 500 at `size` px. */
export function measureText(text: string, size: number): number {
  let total = 0;
  for (const char of text) {
    total += advance(char);
  }
  return (total * size) / 1000;
}

/** Keeps `keepStart` chars from the start and `keepEnd` from the end, with an ellipsis between. */
function cutMiddle(chars: string[], keepStart: number, keepEnd: number): string {
  return (
    chars.slice(0, keepStart).join('') + ELLIPSIS + chars.slice(chars.length - keepEnd).join('')
  );
}

/**
 * The longest middle cut of `text` that fits `maxWidth`: as many characters
 * as fit from each end, the end weighted slightly less than the start.
 */
function fitMiddle(text: string, maxWidth: number, size: number): string {
  const chars = Array.from(text);
  if (measureText(text, size) <= maxWidth) {
    return text;
  }
  let best = '';
  for (let keep = chars.length - 1; keep >= 0; keep--) {
    const start = Math.ceil(keep / 2);
    const candidate = cutMiddle(chars, start, keep - start);
    if (measureText(candidate, size) <= maxWidth) {
      best = candidate;
      break;
    }
  }
  return best;
}

/** The longest end cut of `text` that fits `maxWidth` ("Quarterly rev…"). */
export function fitEnd(text: string, maxWidth: number, size: number): string {
  if (measureText(text, size) <= maxWidth) {
    return text;
  }
  const chars = Array.from(text);
  for (let keep = chars.length - 1; keep >= 0; keep--) {
    const candidate = chars.slice(0, keep).join('').trimEnd() + ELLIPSIS;
    if (keep === 0) {
      return measureText(ELLIPSIS, size) <= maxWidth ? ELLIPSIS : '';
    }
    if (measureText(candidate, size) <= maxWidth) {
      return candidate;
    }
  }
  return '';
}

/**
 * Fits an address (or any text) into `maxWidth` by cutting from the middle.
 * An address keeps its domain and last path segment ("app.example.com/…/q3-launch")
 * whenever those alone fit; otherwise, or for plain text, characters go from
 * the middle.
 */
export function fitAddress(text: string, maxWidth: number, size: number): string {
  if (measureText(text, size) <= maxWidth) {
    return text;
  }
  const slash = text.indexOf('/');
  if (slash > 0) {
    const domain = text.slice(0, slash);
    const segments = text
      .slice(slash + 1)
      .split('/')
      .filter((segment) => segment.length > 0);
    const last = segments[segments.length - 1];
    if (last !== undefined && segments.length > 1) {
      const short = `${domain}/${ELLIPSIS}/${last}`;
      if (measureText(short, size) <= maxWidth) {
        return short;
      }
    }
  }
  return fitMiddle(text, maxWidth, size);
}
