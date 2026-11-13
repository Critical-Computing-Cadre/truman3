import { createHash, randomUUID } from "node:crypto";
import { type Database, schema } from "@truman3/db";
import type { Storage } from "@truman3/storage";
import type { PhotoScanner } from "../scanning.ts";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Works out an image's type from its first bytes, rather than trusting the browser's label. SVG
 * isn't allowed, because it can contain scripts.
 */
export function detectImageType(bytes: Uint8Array): { extension: string; type: string } | null {
  const starts = (...values: number[]) => values.every((value, i) => bytes[i] === value);

  if (starts(0xff, 0xd8, 0xff)) {
    return { extension: "jpg", type: "image/jpeg" };
  }
  if (starts(0x89, 0x50, 0x4e, 0x47)) {
    return { extension: "png", type: "image/png" };
  }
  if (starts(0x47, 0x49, 0x46, 0x38)) {
    return { extension: "gif", type: "image/gif" };
  }
  const text = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (text(0, 4) === "RIFF" && text(8, 12) === "WEBP") {
    return { extension: "webp", type: "image/webp" };
  }
  return null;
}

/** Where one participant's uploads go. Shared by nobody else, so a withdrawal deletes only theirs. */
export function uploadPrefix(worldId: string, participantId: string): string {
  return `uploads/${worldId}/${participantId}/`;
}

/**
 * Stores a participant's image, records it, and returns its key. Returns null if it isn't a usable
 * image.
 *
 * With a scanner, the image is scanned once it's stored (ADR 79). In a shared world, one that's
 * flagged, or that couldn't be scanned, is held: only its uploader and the researchers see it until
 * a researcher decides. In a world of someone's own it's only listed for the researchers, since
 * nobody else can see it anyway.
 */
export async function storeUploadedImage(
  { db, storage, scanner }: { db: Database; storage: Storage; scanner?: PhotoScanner | undefined },
  by: { worldId: string; participantId: string; worldMode: "solo" | "shared" },
  file: File,
): Promise<string | null> {
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
    return null;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectImageType(bytes);
  if (!detected) {
    return null;
  }
  const key = `${uploadPrefix(by.worldId, by.participantId)}${randomUUID()}.${detected.extension}`;
  await storage.put(key, bytes, detected.type);
  const result = scanner ? await scanner.scan(key, detected.extension) : null;
  const doubtful = result !== null && result.scan !== "clear";
  await db.insert(schema.uploads).values({
    key,
    worldId: by.worldId,
    participantId: by.participantId,
    bytes: bytes.length,
    scan: result?.scan ?? "unscanned",
    labels: result && "labels" in result ? result.labels : [],
    held: doubtful && by.worldMode === "shared",
    needsReview: doubtful,
  });
  return key;
}

/**
 * Stores an image for a study, named by a hash of its contents. It's the same scheme imports use, so
 * identical images are stored once, and a frozen version's images can't change later. Returns null
 * if it isn't a usable image.
 */
export async function storeStudyImage(storage: Storage, file: File): Promise<string | null> {
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
    return null;
  }
  return storeStudyImageBytes(storage, new Uint8Array(await file.arrayBuffer()));
}

/** The same, for an image already read, such as one from a zip. */
export async function storeStudyImageBytes(
  storage: Storage,
  bytes: Uint8Array,
): Promise<string | null> {
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    return null;
  }
  const detected = detectImageType(bytes);
  if (!detected) {
    return null;
  }

  const key = `media/${createHash("sha256").update(bytes).digest("hex")}.${detected.extension}`;
  if (!(await storage.exists(key))) {
    await storage.put(key, bytes, detected.type);
  }
  return key;
}
