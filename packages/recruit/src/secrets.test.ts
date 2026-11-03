import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, parseSecretKey } from "./secrets.ts";

describe("stored secrets", () => {
  const key = randomBytes(32);

  it("reads back what it stored, without storing it readably", () => {
    const stored = encryptSecret("my-token", key);
    expect(stored).not.toContain("my-token");
    expect(decryptSecret(stored, key)).toBe("my-token");
  });

  it("stores the same secret differently each time", () => {
    expect(encryptSecret("my-token", key)).not.toBe(encryptSecret("my-token", key));
  });

  it("refuses the wrong key and changed values", () => {
    const stored = encryptSecret("my-token", key);
    expect(() => decryptSecret(stored, randomBytes(32))).toThrow();
    const parts = stored.split(".");
    parts[3] = Buffer.from("changed").toString("base64url");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
  });

  it("only accepts a key of the right length", () => {
    expect(parseSecretKey(key.toString("base64"))).toEqual(key);
    expect(parseSecretKey(undefined)).toBeNull();
    expect(parseSecretKey("short")).toBeNull();
  });
});
