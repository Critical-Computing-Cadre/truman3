/**
 * Truman's mark: steps going up into a sky. The same drawing as the site's (`apps/site/public/
 * truman.svg`), drawn here so it's there as soon as the page is.
 */
export function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 93 93" className={`shrink-0 rounded-md ${className}`}>
      <rect width="93" height="93" fill="#9dd9ff" />
      <path
        d="M13.5 71.5h16.8V54.4h16.8V37.3h16.5V20.5h17L110 50v60H52z"
        fill="#6eacd9"
        fillOpacity="0.7"
      />
      <path
        d="M13.5 71.5h16.8V54.4h16.8V37.3h16.5V20.5h17"
        fill="none"
        stroke="#fff"
        strokeWidth="5.4"
        strokeLinecap="square"
      />
    </svg>
  );
}
