import type { SVGProps } from 'react';

/**
 * The Screenforge Director mark (its two slashes), from director/brand/logo.
 * Drawn in `currentColor` so it reads on any button, and decorative: the
 * button's own text names the action.
 */
export const DirectorMark = ({
  size = 14,
  ...props
}: SVGProps<SVGSVGElement> & { size?: number }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
    data-director-mark=""
    {...props}
  >
    <path d="M3.29 10.46L9.57 4.18L10.06 3.7L10.55 3.21L11.04 2.75L11.53 2.3L12.02 1.89L12.51 1.51L13 1.16L13.49 0.87L13.98 0.61L14.47 0.41L14.96 0.25L15.46 0.13L15.95 0.06L16.44 0.02L16.93 0L17.42 0L23.88 0L13.42 10.46Z" />
    <path d="M20.58 13.54L14.31 19.82L13.82 20.3L13.33 20.79L12.84 21.25L12.35 21.7L11.86 22.11L11.37 22.49L10.88 22.84L10.38 23.13L9.89 23.39L9.4 23.59L8.91 23.75L8.42 23.87L7.93 23.94L7.44 23.98L6.95 24L6.46 24L0 24L10.46 13.54Z" />
  </svg>
);
