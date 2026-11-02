import { describe, expect, it } from "vitest";
import { summarizeDevice } from "./device.ts";

describe("summarizeDevice", () => {
  it.each([
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
      { device: "phone", browser: "Safari" },
    ],
    [
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
      { device: "phone", browser: "Chrome" },
    ],
    [
      "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/604.1",
      { device: "tablet", browser: "Safari" },
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      { device: "tablet", browser: "Chrome" },
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      { device: "desktop", browser: "Chrome" },
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
      { device: "desktop", browser: "Edge" },
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0",
      { device: "desktop", browser: "Firefox" },
    ],
    ["curl/8.0", { device: "desktop", browser: "other" }],
  ])("summarizes %s", (userAgent, expected) => {
    expect(summarizeDevice(userAgent)).toEqual(expected);
  });

  it("handles a missing user agent", () => {
    expect(summarizeDevice(undefined)).toEqual({ device: "unknown", browser: "unknown" });
  });
});
