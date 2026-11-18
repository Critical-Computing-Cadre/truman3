import { createHash, randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { MAX_VIDEO_BYTES, readVideoInfo, type VideoInfo, videoLimitProblem } from "@truman3/core";
import type { Storage } from "@truman3/storage";

/** Where a video waits while it's checked. Never served: CloudFront reads only media/. */
const INCOMING = "incoming/";

export type StoredVideo =
  | { ok: true; key: string; info: Omit<VideoInfo, "codec"> }
  | { ok: false; reason: string };

/**
 * Stores a researcher's video as it arrives, without holding it in memory, then checks it from
 * storage: an MP4 every browser plays, within the limits (ADR 94). A usable one is kept under the
 * checksum of its contents, like a picture, so the same video is stored once and can't change.
 */
export async function storeStudyVideo(
  storage: Storage,
  body: ReadableStream<Uint8Array>,
  length: number,
): Promise<StoredVideo> {
  if (!Number.isInteger(length) || length <= 0) {
    return { ok: false, reason: "It's empty." };
  }
  if (length > MAX_VIDEO_BYTES) {
    return {
      ok: false,
      reason: `It's ${Math.ceil(length / 1024 / 1024)} MB. Videos can be up to ${MAX_VIDEO_BYTES / 1024 / 1024} MB.`,
    };
  }

  const waiting = `${INCOMING}${randomUUID()}.mp4`;
  const hash = createHash("sha256");
  let received = 0;
  const counting = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      received += chunk.length;
      if (received > length) {
        done(new Error("It's bigger than it said it was."));
        return;
      }
      hash.update(chunk);
      done(null, chunk);
    },
  });
  const passing = Readable.fromWeb(body as never).pipe(counting);

  try {
    await storage.putStream(waiting, passing, length, "application/octet-stream");
  } catch {
    await storage.delete(waiting).catch(() => {});
    return { ok: false, reason: "It didn't arrive whole. Try again." };
  }
  if (received !== length) {
    await storage.delete(waiting).catch(() => {});
    return { ok: false, reason: "It didn't arrive whole. Try again." };
  }

  try {
    const read = await readVideoInfo(
      (offset, count) => storage.getRange(waiting, offset, count),
      length,
    );
    const problem = read.ok ? videoLimitProblem(read.info, length) : read.reason;
    if (!read.ok || problem) {
      return { ok: false, reason: problem ?? "It isn't an MP4 video." };
    }
    const key = `media/${hash.digest("hex")}.mp4`;
    if (!(await storage.exists(key))) {
      await storage.copy(waiting, key, "video/mp4");
    }
    const { codec: _codec, ...info } = read.info;
    return { ok: true, key, info };
  } finally {
    await storage.delete(waiting).catch(() => {});
  }
}
