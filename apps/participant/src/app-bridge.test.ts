// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_EVENT, startAppBridge } from "./app-bridge.ts";
import { flushTracking } from "./tracking.ts";

/** The app talks to this site through window events (ADR 66). */
describe("the app bridge", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the app's push token to the API, with this site's session", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetch);
    // What the app sent before the site was ready is handled when it starts.
    (window as { trumanAppQueue?: unknown[] }).trumanAppQueue = [
      { type: "push-token", token: "ExponentPushToken[abc]", platform: "ios" },
    ];
    startAppBridge();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/me/push");
    expect(JSON.parse(init.body as string)).toMatchObject({
      token: "ExponentPushToken[abc]",
      platform: "ios",
    });

    window.dispatchEvent(
      new CustomEvent(APP_EVENT, {
        detail: { type: "push-token", token: "ExponentPushToken[def]", platform: "android" },
      }),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("records why the phone couldn't set up push, when the app says", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ recorded: 1 })));
    vi.stubGlobal("fetch", fetch);
    startAppBridge();
    window.dispatchEvent(
      new CustomEvent(APP_EVENT, {
        detail: { type: "push-permission", granted: true, reason: "No Firebase app" },
      }),
    );
    flushTracking();
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    const sent = calls.map(([, init]) => init.body as string);
    expect(sent.join("")).toContain('"reason":"No Firebase app"');
  });
});
