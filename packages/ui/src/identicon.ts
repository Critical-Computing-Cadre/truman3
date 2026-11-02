const GRID = 5;
/** Only the left half and the middle are chosen. The right half mirrors them. */
const CHOSEN_COLUMNS = 3;

/** Mixes a string into 32 bits, so similar usernames still get very different pictures. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    value = Math.imul(value ^ text.charCodeAt(i), 0x01000193);
  }
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35);
  value ^= value >>> 16;
  return value >>> 0;
}

export interface Identicon {
  color: string;
  /** Which squares of the 5 by 5 grid are filled, as [column, row]. */
  cells: [number, number][];
}

/**
 * A picture made from someone's username, like GitHub's default avatars. The same username always
 * gets the same picture. It's worked out in the browser, so nothing is stored, and nothing about a
 * participant is sent to an outside service.
 */
export function identicon(seed: string): Identicon {
  const bits = hash(seed);
  const cells: [number, number][] = [];

  for (let column = 0; column < CHOSEN_COLUMNS; column += 1) {
    for (let row = 0; row < GRID; row += 1) {
      if ((bits >>> (column * GRID + row)) & 1) {
        cells.push([column, row]);
        const mirrored = GRID - 1 - column;
        if (mirrored !== column) {
          cells.push([mirrored, row]);
        }
      }
    }
  }
  if (cells.length === 0) {
    cells.push([2, 2]);
  }

  const hue = (bits >>> 15) % 360;
  const lightness = 42 + ((bits >>> 28) & 0xf);
  return { color: `hsl(${hue} 55% ${lightness}%)`, cells };
}
