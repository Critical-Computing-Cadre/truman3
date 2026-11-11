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

  it("puts email links to the admin app beside the participant app, or on its own port locally", () => {
    const deployed = parseServerEnv({
      ...required,
      NODE_ENV: "production",
      PARTICIPANT_APP_URL: "https://example.test",
    });
    expect(deployed.ADMIN_APP_URL).toBe("https://example.test/admin/");

    const local = parseServerEnv({
      ...required,
      NODE_ENV: "development",
      PARTICIPANT_APP_URL: "http://localhost:5180",
    });
    expect(local.ADMIN_APP_URL).toBe("http://localhost:5181/admin/");

    const chosen = parseServerEnv({ ...required, ADMIN_APP_URL: "https://admin.example.test/" });
    expect(chosen.ADMIN_APP_URL).toBe("https://admin.example.test/");
  });
});
