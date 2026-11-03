import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env.ts";

const required = { DATABASE_URL: "postgres://x", MEDIA_PUBLIC_URL: "http://media.test" };

describe("parseServerEnv", () => {
  it("falls back to the local participant app during development", () => {
    const env = parseServerEnv({ ...required, NODE_ENV: "development" });

    expect(env.PARTICIPANT_APP_URL).toBe("http://localhost:5180");
  });

  it("refuses to start in production without the participant app's address", () => {
    expect(() => parseServerEnv({ ...required, NODE_ENV: "production" })).toThrow(
      "PARTICIPANT_APP_URL",
    );
  });

  it("uses the address it's given in production", () => {
    const env = parseServerEnv({
      ...required,
      NODE_ENV: "production",
      PARTICIPANT_APP_URL: "https://example.test",
    });

    expect(env.PARTICIPANT_APP_URL).toBe("https://example.test");
  });
});
