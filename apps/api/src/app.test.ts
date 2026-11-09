import type { Database } from "@truman3/db";
import type { Storage } from "@truman3/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AppDependencies, createApp } from "./app.ts";

/** These tests don't reach the database, so most dependencies can be stand-ins. */
function appWith(overrides: Partial<AppDependencies> = {}) {
  return createApp({
    pingDatabase: async () => {},
    db: {} as Database,
    storage: {} as Storage,
    mediaPublicUrl: "http://media.test",
    getClientIp: () => undefined,
    secureCookies: true,
    ...overrides,
  });
}

const healthyApp = () => appWith();

describe("the /api address", () => {
  it("answers under /api, as browsers call it, and without it, as health checks do", async () => {
    expect((await healthyApp().request("/api/health")).status).toBe(200);
    expect((await healthyApp().request("/health")).status).toBe(200);
  });

  it("doesn't treat a path that only starts the same way as /api", async () => {
    expect((await healthyApp().request("/apiary/health")).status).toBe(404);
  });

  it("lists its routes once in the OpenAPI spec, without the prefix", async () => {
    const response = await healthyApp().request("/api/openapi.json");
    const spec = (await response.json()) as { paths: Record<string, unknown> };

    expect(Object.keys(spec.paths)).toContain("/health");
    expect(Object.keys(spec.paths)).not.toContain("/api/health");
  });
});

describe("API health", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports the process is up", async () => {
    const response = await healthyApp().request("/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("reports ready when the database answers", async () => {
    const response = await healthyApp().request("/health/ready");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("reports unavailable without exposing the error when the database doesn't answer", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = appWith({
      pingDatabase: async () => {
        throw new Error("password authentication failed");
      },
    });

    const response = await app.request("/health/ready");

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
    expect(logged).toHaveBeenCalledOnce();
  });

  it("publishes its routes in the OpenAPI spec", async () => {
    const response = await healthyApp().request("/openapi.json");
    const spec = (await response.json()) as { paths: Record<string, unknown> };

    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining(["/health", "/health/ready", "/studies/{slug}/enter", "/me"]),
    );
  });
});

describe("a request the API can't read", () => {
  it("is answered as the sender's mistake, not as the server's", async () => {
    const response = await appWith().request("/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "this isn't JSON",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "That request couldn't be read." });
  });
});
