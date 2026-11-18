import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStorage, storageConfigFromEnv } from "./index.ts";

// Against the local S3-compatible storage, as the API and the import use it.
const envFile = path.resolve(import.meta.dirname, "../../../.env");
if (existsSync(envFile)) {
  loadEnvFile(envFile);
}
const storage = createStorage(storageConfigFromEnv());
const prefix = `itest/${randomUUID()}/`;
const bytes = new Uint8Array(Array.from({ length: 1000 }, (_, i) => i % 251));

beforeAll(async () => {
  await storage.ensureBucket();
  await storage.put(`${prefix}file`, bytes, "application/octet-stream");
});
afterAll(async () => {
  await storage.deletePrefix(prefix);
  storage.close();
});

describe("storage, for videos", () => {
  it("reads part of a file, and none past its end", async () => {
    expect(await storage.getRange(`${prefix}file`, 10, 5)).toEqual(bytes.slice(10, 15));
    expect(await storage.getRange(`${prefix}file`, 995, 100)).toEqual(bytes.slice(995));
    expect(await storage.getRange(`${prefix}file`, 5000, 10)).toEqual(new Uint8Array());
  });

  it("says how big a file is", async () => {
    expect(await storage.size(`${prefix}file`)).toBe(1000);
    expect(await storage.size(`${prefix}missing`)).toBeNull();
  });

  it("stores a stream, and copies it with a type of its own", async () => {
    await storage.putStream(
      `${prefix}streamed`,
      Readable.from([bytes.slice(0, 600), bytes.slice(600)]),
      1000,
      "application/octet-stream",
    );
    await storage.copy(`${prefix}streamed`, `${prefix}copied.mp4`, "video/mp4");
    expect(await storage.getRange(`${prefix}copied.mp4`, 0, 1000)).toEqual(bytes);
  });
});
