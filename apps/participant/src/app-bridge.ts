import { post } from "./api.ts";
import { track } from "./tracking.ts";

/**
 * When this site runs inside Truman's app (ADR 66), the app tells it what only the app knows, with
 * a "truman-app" event on the window: where to send push notifications, whether they allowed them,
 * and when the app is opened, closed, or opened from a notification. This site sends it all to the
 * API, with its own session, so the app never handles who someone is.
 */
export type AppMessage =
  | { type: "push-token"; token: string; platform: "ios" | "android" }
  | { type: "push-permission"; granted: boolean }
  | { type: "opened"; platform: "ios" | "android" }
  | { type: "closed"; secondsOpen: number }
  | { type: "push-opened"; kind: "notification" | "message" };

export const APP_EVENT = "truman-app";

export function handleAppMessage(message: AppMessage) {
  switch (message.type) {
    case "push-token":
      // A study without push notifications says no, which is fine.
      post("/me/push", { token: message.token, platform: message.platform }).catch(() => {});
      return;
    case "push-permission":
      track({ type: "push.permission", payload: { granted: message.granted } });
      return;
    case "opened":
      track({ type: "app.opened", payload: { platform: message.platform } });
      return;
    case "closed":
      track({ type: "app.closed", payload: { secondsOpen: message.secondsOpen } });
      return;
    case "push-opened":
      track({ type: "push.opened", payload: { kind: message.kind } });
      return;
  }
}

let listening = false;

/** Starts listening for the app. Outside the app, nothing ever arrives. */
export function startAppBridge() {
  if (listening) {
    return;
  }
  listening = true;
  // Tells the app it can send messages now, rather than leave them waiting.
  (window as { trumanAppReady?: boolean }).trumanAppReady = true;
  window.addEventListener(APP_EVENT, (event) => {
    const message = (event as CustomEvent<AppMessage>).detail;
    if (message && typeof message === "object" && "type" in message) {
      handleAppMessage(message);
    }
  });
  // Messages the app sent before this site was ready wait here.
  const waiting = (window as { trumanAppQueue?: AppMessage[] }).trumanAppQueue ?? [];
  for (const message of waiting.splice(0)) {
    handleAppMessage(message);
  }
}
