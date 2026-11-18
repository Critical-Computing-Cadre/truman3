import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_VIDEO_BYTES, readVideoInfo, videoLimitProblem } from "./video.ts";

// Small videos made with Apple's AVFoundation: H.264 with and without sound, HEVC, and QuickTime.
const fixture = (name: string) =>
  new Uint8Array(readFileSync(path.join(import.meta.dirname, "video-fixtures", name)));

/** Reads from bytes in memory, counting how much was read, to show the video itself isn't. */
function reader(bytes: Uint8Array) {
  const counted = { bytes: 0 };
  const read = async (offset: number, length: number) => {
    const part = bytes.slice(offset, offset + length);
    counted.bytes += part.length;
    return part;
  };
  return { read, counted };
}
const infoOf = (bytes: Uint8Array) => readVideoInfo(reader(bytes).read, bytes.length);

describe("readVideoInfo", () => {
  it("reads an H.264 MP4's length, size, and sound", async () => {
    expect(await infoOf(fixture("h264.mp4"))).toEqual({
      ok: true,
      info: {
        seconds: expect.closeTo(2, 1),
        width: 180,
        height: 320,
        hasSound: true,
        codec: "avc1",
      },
    });
    expect(await infoOf(fixture("silent.mp4"))).toMatchObject({
      ok: true,
      info: { seconds: expect.closeTo(1, 1), width: 160, height: 90, hasSound: false },
    });
  });

  it("reads only the parts that describe it", async () => {
    // A video with a megabyte of picture data before its description.
    const real = fixture("silent.mp4");
    const filler = new Uint8Array(1024 * 1024 + 8);
    new DataView(filler.buffer).setUint32(0, filler.length);
    filler.set([0x66, 0x72, 0x65, 0x65], 4); // "free"
    const ftypLength = new DataView(real.buffer, real.byteOffset).getUint32(0);
    const padded = new Uint8Array(real.length + filler.length);
    padded.set(real.slice(0, ftypLength));
    padded.set(filler, ftypLength);
    padded.set(real.slice(ftypLength), ftypLength + filler.length);
    const { read, counted } = reader(padded);
    expect((await readVideoInfo(read, padded.length)).ok).toBe(true);
    expect(counted.bytes).toBeLessThan(real.length + 200);
  });

  it("says what to do with one browsers can't all play", async () => {
    expect(await infoOf(fixture("hevc.mp4"))).toEqual({
      ok: false,
      reason: expect.stringContaining("Export it as H.264"),
    });
    expect(await infoOf(fixture("qt.mov"))).toEqual({
      ok: false,
      reason: "It's a QuickTime (.mov) file. Export it as an MP4 instead.",
    });
  });

  it("refuses what isn't a video", async () => {
    const notVideo = { ok: false, reason: "It isn't an MP4 video." };
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    expect(await infoOf(png)).toEqual(notVideo);
    expect(await infoOf(new Uint8Array())).toEqual(notVideo);
    // A HEIC photo starts like an MP4, with its own brand.
    const heic = new Uint8Array(24);
    new DataView(heic.buffer).setUint32(0, 24);
    heic.set(new TextEncoder().encode("ftypheic\0\0\0\0mif1heic"), 4);
    expect(await infoOf(heic)).toEqual(notVideo);
    // The start of a real one, cut off before its description.
    expect(await infoOf(fixture("h264.mp4").slice(0, 40))).toEqual(notVideo);
  });
});

describe("videoLimitProblem", () => {
  const info = { seconds: 30, width: 1080, height: 1920, hasSound: true, codec: "avc1" };
  it("allows up to 10 minutes and 200 MB", () => {
    expect(videoLimitProblem({ ...info, seconds: 600 }, MAX_VIDEO_BYTES)).toBeNull();
    expect(videoLimitProblem({ ...info, seconds: 601 }, 1000)).toBe(
      "It's 11 minutes long. Videos can be up to 10 minutes.",
    );
    expect(videoLimitProblem(info, MAX_VIDEO_BYTES + 1)).toBe(
      "It's 201 MB. Videos can be up to 200 MB.",
    );
  });
});
