/**
 * Draws the pictures the starter studies use (studies/starters), so they need no stock photos and
 * have no licence to track. Each is a simple scene: hills, a meal, a city, a beach. Run it again to
 * remake them: node scripts/starter-pictures.ts
 *
 * Since ADR 76 the starters use photos from the EatSnap example for nearly everything, and only a
 * few of these are still used (two banners, a city at night, a community's banner). Running this
 * writes all of them again, so delete the ones no starter names before committing.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";

type Color = [number, number, number];
type Paint = (x: number, y: number, width: number, height: number) => Color;

const hex = (value: string): Color => [
  Number.parseInt(value.slice(1, 3), 16),
  Number.parseInt(value.slice(3, 5), 16),
  Number.parseInt(value.slice(5, 7), 16),
];
const mix = (a: Color, b: Color, t: number): Color => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

function png(width: number, height: number, paint: Paint): Buffer {
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const start = y * (width * 3 + 1);
    rows[start] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y, width, height);
      rows[start + 1 + x * 3] = r;
      rows[start + 2 + x * 3] = g;
      rows[start + 3 + x * 3] = b;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Sky, a sun, and layers of hills, each a gentle wave. */
function hills(sky: [string, string], sun: string, layers: string[], sunAt = [0.7, 0.3]): Paint {
  const [top, bottom] = [hex(sky[0]), hex(sky[1])];
  const sunColor = hex(sun);
  const colors = layers.map(hex);
  return (x, y, w, h) => {
    const u = x / w;
    const v = y / h;
    for (let i = colors.length - 1; i >= 0; i--) {
      const base = 0.55 + i * 0.12;
      const wave = Math.sin(u * (3 + i) * Math.PI + i * 1.7) * 0.05;
      if (v > base + wave) {
        return colors[i] as Color;
      }
    }
    const dx = u - (sunAt[0] as number);
    const dy = (v - (sunAt[1] as number)) * (h / w);
    if (dx * dx + dy * dy < 0.008) {
      return sunColor;
    }
    return mix(top, bottom, v / 0.7);
  };
}

/** A plate on a table, from above, with food in rings and spots. */
function meal(table: string, food: string[]): Paint {
  const tableColor = hex(table);
  const plate: Color = [246, 244, 238];
  const rim: Color = [226, 222, 214];
  const colors = food.map(hex);
  return (x, y, w, h) => {
    const dx = x / w - 0.5;
    const dy = y / h - 0.5;
    const r = Math.sqrt(dx * dx + dy * dy);
    const stripe = Math.floor((x + y) / (w / 12)) % 2 === 0;
    if (r > 0.42) {
      return stripe ? tableColor : mix(tableColor, [255, 255, 255], 0.12);
    }
    if (r > 0.38) {
      return rim;
    }
    for (let i = 0; i < colors.length; i++) {
      const angle = (i / colors.length) * Math.PI * 2;
      const cx = Math.cos(angle) * 0.14;
      const cy = Math.sin(angle) * 0.14;
      const fx = dx - cx;
      const fy = dy - cy;
      if (fx * fx + fy * fy < 0.012) {
        return colors[i] as Color;
      }
    }
    return plate;
  };
}

/** Buildings against the sky, with lit windows. */
function city(sky: [string, string], building: string, windows: string): Paint {
  const [top, bottom] = [hex(sky[0]), hex(sky[1])];
  const wall = hex(building);
  const lit = hex(windows);
  return (x, y, w, h) => {
    const u = x / w;
    const v = y / h;
    const column = Math.floor(u * 7);
    const roof = 0.35 + ((column * 37) % 5) * 0.08;
    if (v > roof) {
      const wx = (u * 7 * 4) % 1;
      const wy = (v * 30) % 1;
      const on = (column + Math.floor(v * 30)) % 3 !== 0;
      return wx > 0.3 && wx < 0.7 && wy > 0.3 && wy < 0.7 && on ? lit : wall;
    }
    return mix(top, bottom, v / roof);
  };
}

/** Sea, sand, and sky in bands, with a sun low on the water. */
function beach(sky: [string, string], sea: string, sand: string): Paint {
  const [top, bottom] = [hex(sky[0]), hex(sky[1])];
  const water = hex(sea);
  const shore = hex(sand);
  return (x, y, w, h) => {
    const u = x / w;
    const v = y / h;
    const shoreline = 0.72 + Math.sin(u * Math.PI * 4) * 0.02;
    if (v > shoreline) {
      return shore;
    }
    if (v > 0.5) {
      return mix(water, [255, 255, 255], ((v * 40) % 1 < 0.1 ? 0.25 : 0) as number);
    }
    const dx = u - 0.5;
    const dy = (v - 0.45) * (h / w);
    if (dx * dx + dy * dy < 0.01) {
      return [255, 214, 140];
    }
    return mix(top, bottom, v / 0.5);
  };
}

const ROOT = path.resolve(import.meta.dirname, "../studies/starters");
const POSTS = "media/posts";

const pictures: Record<string, { size: [number, number]; paint: Paint; folders: string[] }> = {
  "hills-dawn.png": {
    size: [640, 640],
    paint: hills(["#f9c58d", "#f6e7c1"], "#fff3d6", ["#6b8f71", "#4b6e57", "#2f4a3a"]),
    folders: ["photo", "classic", "forum"],
  },
  "hills-dusk.png": {
    size: [640, 640],
    paint: hills(["#3b3363", "#e2787a"], "#ffd59e", ["#5a4a6b", "#3c3352", "#241f36"], [0.3, 0.45]),
    folders: ["photo", "forum", "classic"],
  },
  "lake-trail.png": {
    size: [640, 480],
    paint: hills(["#8ec5e8", "#d8eef9"], "#ffffff", ["#7aa874", "#4f7f58", "#36604a"]),
    folders: ["photo", "classic", "forum", "short-posts"],
  },
  "pasta.png": {
    size: [640, 640],
    paint: meal("#c2884f", ["#e9b949", "#d1452f", "#7aa349", "#e9b949"]),
    folders: ["photo", "classic", "forum"],
  },
  "salad.png": {
    size: [640, 640],
    paint: meal("#4e6e8e", ["#6fae4b", "#e0503a", "#f2d14a", "#8bc061", "#6fae4b"]),
    folders: ["photo", "classic", "forum"],
  },
  "city-night.png": {
    size: [640, 640],
    paint: city(["#0d1b3d", "#3a4a7d"], "#1c2238", "#f6d47a"),
    folders: ["photo", "short-posts", "classic"],
  },
  "city-day.png": {
    size: [640, 480],
    paint: city(["#77b6ea", "#cfe7f7"], "#8a8f99", "#d9e6f2"),
    folders: ["short-posts", "forum"],
  },
  "beach.png": {
    size: [640, 640],
    paint: beach(["#ff9f7a", "#ffd9a8"], "#2e86ab", "#f2d7a0"),
    folders: ["photo", "classic"],
  },
  "story-sunrise.png": {
    size: [540, 960],
    paint: hills(["#f7a072", "#fde4c3"], "#fff5e1", ["#7f9f7f", "#56795c", "#33503f"], [0.5, 0.35]),
    folders: ["photo"],
  },
  "story-city.png": {
    size: [540, 960],
    paint: city(["#24123d", "#b44c7c"], "#1e1730", "#ffd27a"),
    folders: ["photo"],
  },
  "story-beach.png": {
    size: [540, 960],
    paint: beach(["#5fa8d3", "#cae9ff"], "#1b6f99", "#efd9a7"),
    folders: ["photo"],
  },
  "story-meal.png": {
    size: [540, 960],
    paint: meal("#7a5c3e", ["#f0c04a", "#c4422c", "#6aa448"]),
    folders: ["photo"],
  },
};

const banners: Record<string, { paint: Paint; folders: string[] }> = {
  "banner-hills.png": {
    paint: hills(["#9cc9e8", "#e6f3fb"], "#ffffff", ["#86b07c", "#5d8a63"], [0.85, 0.4]),
    folders: ["short-posts"],
  },
  "banner-city.png": {
    paint: city(["#1a2a5c", "#6c7fb8"], "#202640", "#ffd98a"),
    folders: ["short-posts", "forum"],
  },
};

for (const [name, { size, paint, folders }] of Object.entries(pictures)) {
  const bytes = png(size[0], size[1], paint);
  for (const folder of folders) {
    mkdirSync(path.join(ROOT, folder, POSTS), { recursive: true });
    writeFileSync(path.join(ROOT, folder, POSTS, name), bytes);
  }
}
for (const [name, { paint, folders }] of Object.entries(banners)) {
  const bytes = png(1200, 400, paint);
  for (const folder of folders) {
    const where = folder === "forum" ? "media/spaces" : "media/actors";
    mkdirSync(path.join(ROOT, folder, where), { recursive: true });
    writeFileSync(path.join(ROOT, folder, where, name), bytes);
  }
}
console.log(`Drew ${Object.keys(pictures).length + Object.keys(banners).length} pictures.`);
