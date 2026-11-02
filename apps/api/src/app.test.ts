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
