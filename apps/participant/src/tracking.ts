import { actionMeta } from "./api.ts";

const FLUSH_EVERY_MS = 5_000;
const HEARTBEAT_EVERY_MS = 15_000;
const MAX_BATCH = 200;

type ReportedEvent =
  | { type: "page.viewed"; payload: { page: string } }
  | { type: "session.heartbeat"; payload: { activeMs: number; page: string } }
  | {
      type: "content.viewed";
      targetContentId: string;
      payload: { dwellMs: number; surface: string };
    };

let queue: (ReportedEvent & ReturnType<typeof actionMeta>)[] = [];
let running = false;

/** Adds a timing report to send soon. */
export function track(event: ReportedEvent) {
  queue.push({ ...actionMeta(), ...event });
}

function flush() {
  if (queue.length === 0) {
    return;
  }
  const events = queue.slice(0, MAX_BATCH);
  queue = queue.slice(MAX_BATCH);

  // `keepalive` lets this finish even if the page is closing.
  fetch("/api/events", {
    method: "POST",
    keepalive: true,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events }),
  }).catch(() => {
    // Each report has its own ID, so trying again can't count anything twice.
    queue = [...events, ...queue];
  });
}

/** Starts sending reports, and counting active time. Only ever runs once. */
export function startTracking() {
  if (running) {
    return;
  }
  running = true;

  let lastBeat = Date.now();
  setInterval(() => {
    const now = Date.now();
    if (document.visibilityState === "visible") {
      track({
        type: "session.heartbeat",
        payload: { activeMs: now - lastBeat, page: window.location.pathname },
      });
    }
    lastBeat = now;
  }, HEARTBEAT_EVERY_MS);

  setInterval(flush, FLUSH_EVERY_MS);
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flush();
    }
  });
}

export const flushTracking = flush;
