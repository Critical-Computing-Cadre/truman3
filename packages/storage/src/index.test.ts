import { describe, expect, it } from "vitest";
import { clientConfig, storageConfigFromEnv } from "./index.ts";

const BASE = { S3_REGION: "us-east-1", S3_BUCKET: "media" };

describe("storageConfigFromEnv", () => {
  it("needs no keys, for a container that has a role on AWS", () => {
    const config = storageConfigFromEnv(BASE);
    expect(config.accessKeyId).toBeUndefined();
    expect(clientConfig(config)).toEqual({ region: "us-east-1" });
  });

  it("uses keys and an address when they're set, as local storage does", () => {
    const config = storageConfigFromEnv({
      ...BASE,
      S3_ENDPOINT: "http://localhost:8333",
      S3_ACCESS_KEY_ID: "local",
      S3_SECRET_ACCESS_KEY: "local",
    });
    expect(clientConfig(config)).toEqual({
      region: "us-east-1",
      endpoint: "http://localhost:8333",
      forcePathStyle: true,
      credentials: { accessKeyId: "local", secretAccessKey: "local" },
    });
  });

  it.each([{ S3_ACCESS_KEY_ID: "only" }, { S3_SECRET_ACCESS_KEY: "only" }])(
    "refuses one key without the other",
    (key) => {
      expect(() => storageConfigFromEnv({ ...BASE, ...key })).toThrow(/both/);
    },
  );

  it("still needs a region and a bucket", () => {
    expect(() => storageConfigFromEnv({ S3_BUCKET: "media" })).toThrow(/S3_REGION/);
    expect(() => storageConfigFromEnv({ S3_REGION: "us-east-1" })).toThrow(/S3_BUCKET/);
  });
});
