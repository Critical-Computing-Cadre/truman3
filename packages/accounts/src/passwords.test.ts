import { describe, expect, it } from "vitest";
import { generatePassword, hashPassword, verifyPassword } from "./passwords.ts";

describe("passwords", () => {
  it("accepts the right password and rejects others", async () => {
    const stored = await hashPassword("correct horse");

    expect(await verifyPassword("correct horse", stored)).toBe(true);
    expect(await verifyPassword("wrong horse", stored)).toBe(false);
  });

  it("never stores the password itself, and gives the same password different hashes", async () => {
    const first = await hashPassword("correct horse");
    const second = await hashPassword("correct horse");

    expect(first).not.toContain("correct horse");
    expect(first).not.toBe(second);
  });

  it("rejects a malformed stored value rather than throwing", async () => {
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
  });

  it("generates long, different passwords", () => {
    expect(generatePassword().length).toBeGreaterThanOrEqual(24);
    expect(generatePassword()).not.toBe(generatePassword());
  });
});
