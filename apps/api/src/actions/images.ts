import { randomUUID } from "node:crypto";
import type { Storage } from "@truman3/storage";

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

/** Key prefix for everything participants upload, so a withdrawal can find and delete it. */
export function uploadPrefix(worldId: string): string {
  return `uploads/${worldId}/`;
}

/** Stores a participant's image and returns its key. Returns null if it isn't a usable image. */
export async function storeUploadedImage(
  storage: Storage,
  worldId: string,
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
  const key = `${uploadPrefix(worldId)}${randomUUID()}.${detected.extension}`;
  await storage.put(key, bytes, detected.type);
  return key;
}
