import { identicon } from "./identicon.ts";

/**
 * Someone's picture. Without one, they get a picture made from their username, so `seed` should
 * stay the same for a person wherever they appear.
 */
export function Avatar({
  seed,
  url,
  size = "h-10 w-10",
  shape = "rounded-full",
}: {
  seed: string;
  url: string | null;
  size?: string;
  shape?: string;
}) {
  if (url) {
    return <img src={url} alt="" loading="lazy" className={`${size} ${shape} object-cover`} />;
  }
  const { color, cells } = identicon(seed);
  return (
    // The margin of one square keeps the corners from being cut off by a round picture.
    <svg
      aria-hidden="true"
      viewBox="-1 -1 7 7"
      shapeRendering="crispEdges"
      className={`${size} ${shape} block shrink-0 bg-stone-100`}
    >
      {cells.map(([column, row]) => (
        <rect key={`${column},${row}`} x={column} y={row} width="1" height="1" fill={color} />
      ))}
    </svg>
  );
}
