/**
 * Reading an MP4 file's own description of itself: whether it's an MP4 at all, how long it plays,
 * how big its picture is, whether it has sound, and how its picture is encoded. Truman doesn't
 * convert videos (ADR 94), so a video has to be one every browser can play as it is.
 *
 * It reads only the small boxes that describe the file, through `read`, so the same code works on
 * a file on disk and on one in storage, without loading the video itself.
 */

/** Up to 10 minutes, and 200 MB (Dominic's answer, 2026-11-18). */
export const MAX_VIDEO_SECONDS = 10 * 60;
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

export interface VideoInfo {
  seconds: number;
  width: number;
  height: number;
  hasSound: boolean;
  /** The picture's encoding, from the file: avc1 is H.264, which every browser plays. */
  codec: string;
}

/** Reads `length` bytes from `offset`. Fewer come back at the end of the file. */
export type ReadBytes = (offset: number, length: number) => Promise<Uint8Array>;

// Brands that mean an ordinary MP4. Image formats such as HEIC and AVIF start the same way, and
// aren't on this list. QuickTime (.mov) isn't either: not every browser plays it.
const MP4_BRANDS = new Set([
  "isom",
  "iso2",
  "iso3",
  "iso4",
  "iso5",
  "iso6",
  "mp41",
  "mp42",
  "avc1",
  "M4V ",
  "M4VP",
  "dash",
  "mmp4",
  "MSNV",
  "XAVC",
]);

/** Codecs every current browser plays. */
export const PLAYABLE_CODECS = new Set(["avc1", "avc3"]);

const text = (bytes: Uint8Array, at: number) =>
  String.fromCharCode(bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0);
const u32 = (bytes: Uint8Array, at: number) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at);
const u64 = (bytes: Uint8Array, at: number) => u32(bytes, at) * 2 ** 32 + u32(bytes, at + 4);

interface Box {
  type: string;
  /** Where its contents start, and end, from the start of what was searched. */
  start: number;
  end: number;
}

/** The boxes directly inside `bytes`, from `from` to `to`. */
function boxesIn(bytes: Uint8Array, from = 0, to = bytes.length): Box[] {
  const boxes: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = u32(bytes, at);
    let header = 8;
    if (size === 1) {
      if (at + 16 > to) break;
      size = u64(bytes, at + 8);
      header = 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < header) break;
    boxes.push({ type: text(bytes, at + 4), start: at + header, end: Math.min(at + size, to) });
    at += size;
  }
  return boxes;
}

const child = (bytes: Uint8Array, box: Box | undefined, type: string) =>
  box ? boxesIn(bytes, box.start, box.end).find((inner) => inner.type === type) : undefined;

/**
 * What an MP4 says about itself, or why it can't be used. The reasons are written for the
 * researcher who chose the file.
 */
export async function readVideoInfo(
  read: ReadBytes,
  size: number,
): Promise<{ ok: true; info: VideoInfo } | { ok: false; reason: string }> {
  const fail = (reason: string) => ({ ok: false as const, reason });
  const notMp4 = fail("It isn't an MP4 video.");

  // Walk the top-level boxes, reading only each one's header, to find the description.
  let at = 0;
  let moov: Uint8Array | null = null;
  let sawType = false;
  for (let step = 0; at + 8 <= size && step < 1000; step++) {
    const head = await read(at, 16);
    if (head.length < 8) break;
    let length = u32(head, 0);
    const type = text(head, 4);
    if (length === 1) {
      if (head.length < 16) break;
      length = u64(head, 8);
    } else if (length === 0) {
      length = size - at;
    }
    if (length < 8) return notMp4;
    if (step === 0) {
      if (type !== "ftyp") return notMp4;
      const brands = await read(at + 8, Math.min(length - 8, 64));
      const named = [text(brands, 0)];
      for (let i = 8; i + 4 <= brands.length; i += 4) named.push(text(brands, i));
      if (!named.some((brand) => MP4_BRANDS.has(brand))) {
        return named.includes("qt  ")
          ? fail("It's a QuickTime (.mov) file. Export it as an MP4 instead.")
          : notMp4;
      }
      sawType = true;
    }
    if (type === "moov") {
      // The description is small, even for a long video. Anything big isn't one.
      if (length > 32 * 1024 * 1024) return notMp4;
      moov = await read(at, length);
      break;
    }
    at += length;
  }
  if (!sawType || !moov) return notMp4;

  const top = boxesIn(moov)[0];
  const mvhd = child(moov, top, "mvhd");
  if (!top || !mvhd) return notMp4;
  const version = moov[mvhd.start] ?? 0;
  const timescale = u32(moov, mvhd.start + (version === 1 ? 20 : 12));
  const duration = version === 1 ? u64(moov, mvhd.start + 24) : u32(moov, mvhd.start + 16);
  if (!timescale) return notMp4;

  let width = 0;
  let height = 0;
  let codec = "";
  let hasSound = false;
  for (const trak of boxesIn(moov, top.start, top.end).filter((box) => box.type === "trak")) {
    const mdia = child(moov, trak, "mdia");
    const hdlr = child(moov, mdia, "hdlr");
    const handler = hdlr ? text(moov, hdlr.start + 8) : "";
    if (handler === "soun") {
      hasSound = true;
    } else if (handler === "vide" && !codec) {
      const tkhd = child(moov, trak, "tkhd");
      if (tkhd) {
        const tkhdVersion = moov[tkhd.start] ?? 0;
        // Width and height are the last two fields, as 16.16 fixed point.
        const sizeAt = tkhd.start + (tkhdVersion === 1 ? 88 : 76);
        width = Math.round(u32(moov, sizeAt) / 65536);
        height = Math.round(u32(moov, sizeAt + 4) / 65536);
      }
      const stsd = child(moov, child(moov, child(moov, mdia, "minf"), "stbl"), "stsd");
      // A version and flags, a count, then the first entry's size and type.
      codec = stsd ? text(moov, stsd.start + 12) : "";
    }
  }
  if (!codec) return fail("It has no picture in it.");
  if (!PLAYABLE_CODECS.has(codec)) {
    return fail(
      codec === "hvc1" || codec === "hev1"
        ? "It's encoded as HEVC (H.265), which some browsers can't play. Export it as H.264. Many apps call this “Most compatible”."
        : `It's encoded as ${codec.trim()}, which some browsers can't play. Export it as H.264.`,
    );
  }
  return { ok: true, info: { seconds: duration / timescale, width, height, hasSound, codec } };
}

/** Checks a video against Truman's limits, after `readVideoInfo` has said it's playable. */
export function videoLimitProblem(info: VideoInfo, bytes: number): string | null {
  if (bytes > MAX_VIDEO_BYTES) {
    return `It's ${Math.ceil(bytes / 1024 / 1024)} MB. Videos can be up to ${MAX_VIDEO_BYTES / 1024 / 1024} MB.`;
  }
  if (info.seconds > MAX_VIDEO_SECONDS) {
    return `It's ${Math.ceil(info.seconds / 60)} minutes long. Videos can be up to ${MAX_VIDEO_SECONDS / 60} minutes.`;
  }
  return null;
}
