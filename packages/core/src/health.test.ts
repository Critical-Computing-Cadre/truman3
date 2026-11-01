import { describe, expect, it } from "vitest";
import { healthResponseSchema } from "./health.ts";

describe("healthResponseSchema", () => {
  it("accepts an ok response", () => {
    expect(healthResponseSchema.parse({ status: "ok" })).toEqual({ status: "ok" });
  });

  it("rejects any other status", () => {
    expect(healthResponseSchema.safeParse({ status: "down" }).success).toBe(false);
  });
});
