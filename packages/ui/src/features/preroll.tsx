import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createWatchMeter } from "./video.tsx";

/** An ad to play before a video, as the participant app gets it (ADR 97). */
export interface PrerollAd {
  id: string;
  url: string;
  posterUrl: string | null;
  advertiser: string;
  label: string;
  link: string | null;
}

/** What happened with one ad, as the `preroll.watched` event records it. */
export interface PrerollReport {
  playedMs: number;
  seconds: number;
  skippedAt: number | null;
  completed: boolean;
  visited: boolean;
  soundOn: boolean;
}

export interface Preroll {
  ad: PrerollAd;
  /** Seconds before Skip appears, or "never". */
  skipAfter: number | "never";
  /** Called once, when it's over: played to the end, or skipped. */
  onDone: () => void;
  /** Called once, with what happened, when it's over or the page closes. */
  onReport: (report: PrerollReport) => void;
}

/**
 * An ad for a watch page to play before its video. The participant app gives one when this video
 * gets one. Without it, the video plays straight away.
 */
export const PrerollContext = createContext<Preroll | null>(null);

const clock = (seconds: number) => {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

/**
 * A pre-roll ad (ADR 97): it plays where the video will, says it's an ad and who it's from, has
 * Visit site if the ad has a link, and Skip once it's allowed. There are no controls to seek it.
 */
export function PrerollPlayer() {
  const preroll = useContext(PrerollContext);
  const ref = useRef<HTMLVideoElement>(null);
  const [at, setAt] = useState(0);
  const [length, setLength] = useState(0);
  const state = useRef({ visited: false, done: false, sent: false });
  const skip = useRef<() => void>(() => {});

  useEffect(() => {
    const element = ref.current;
    if (!element || !preroll) {
      return;
    }
    state.current = { visited: false, done: false, sent: false };
    const meter = createWatchMeter(0);
    const report = (skippedAt: number | null, completed: boolean) => {
      if (state.current.sent) {
        return;
      }
      state.current.sent = true;
      meter.paused(false);
      const taken = meter.take();
      preroll.onReport({
        playedMs: taken?.playedMs ?? 0,
        seconds: element.duration || 0,
        skippedAt,
        completed,
        visited: state.current.visited,
        soundOn: taken?.soundOn ?? !element.muted,
      });
    };
    const listeners: [string, () => void][] = [
      ["playing", () => meter.playing()],
      ["pause", () => meter.paused(false)],
      ["timeupdate", () => setAt(element.currentTime)],
      ["loadedmetadata", () => setLength(element.duration)],
      ["volumechange", () => meter.sound(!element.muted && element.volume > 0)],
      [
        "ended",
        () => {
          report(null, true);
          state.current.done = true;
          preroll.onDone();
        },
      ],
    ];
    for (const [name, listener] of listeners) {
      element.addEventListener(name, listener);
    }
    meter.sound(!element.muted && element.volume > 0);
    // With sound if the click that opened the page allows it, and without if not.
    element.play().catch(() => {
      element.muted = true;
      element.play().catch(() => {});
    });
    // Ahead of the participant app's own send as the page closes, as video.watched does.
    // Leaving part way is worth a report. Being set up and taken down before it plays isn't, as
    // React does once in development.
    const leave = () => {
      if (element.currentTime > 0 || state.current.visited) {
        report(null, false);
      }
    };
    window.addEventListener("pagehide", leave, { capture: true });
    skip.current = () => {
      report(element.currentTime, false);
      state.current.done = true;
      element.pause();
      preroll.onDone();
    };
    return () => {
      window.removeEventListener("pagehide", leave, { capture: true });
      for (const [name, listener] of listeners) {
        element.removeEventListener(name, listener);
      }
      leave();
    };
  }, [preroll]);

  if (!preroll) {
    return null;
  }
  const { ad, skipAfter } = preroll;
  const canSkip = skipAfter !== "never" && at >= skipAfter;
  return (
    <section
      aria-label={`${ad.label} from ${ad.advertiser}`}
      className="relative aspect-video max-h-[75vh] w-full overflow-hidden bg-[#000] sm:rounded-xl"
    >
      {/* biome-ignore lint/a11y/useMediaCaption: researchers' videos have no captions yet (ADR 94) */}
      <video
        ref={ref}
        src={ad.url}
        poster={ad.posterUrl ?? undefined}
        playsInline
        preload="auto"
        aria-label="Ad"
        className="h-full w-full object-contain"
      />
      <p className="absolute top-3 left-3 rounded bg-[#000]/60 px-2 py-1 text-xs font-semibold text-[#fff]">
        <span className="mr-1 rounded-sm bg-[#facc15] px-1 text-[#000]">{ad.label}</span>
        {length > 0 && clock(length - at)}
      </p>
      <div className="absolute bottom-3 left-3 flex items-center gap-2">
        <span className="rounded bg-[#000]/60 px-2 py-1 text-sm font-semibold text-[#fff]">
          {ad.advertiser}
        </span>
        {ad.link && (
          <a
            href={ad.link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              state.current.visited = true;
            }}
            className="rounded bg-[#fff] px-3 py-1 text-sm font-semibold text-[#000]"
          >
            Visit site
          </a>
        )}
      </div>
      {skipAfter !== "never" && (
        <button
          type="button"
          disabled={!canSkip}
          onClick={() => skip.current()}
          className="absolute right-0 bottom-6 bg-[#000]/70 px-4 py-2 text-sm font-semibold text-[#fff] disabled:text-[#ddd]"
        >
          {canSkip ? "Skip ad ›" : `Skip in ${Math.max(1, Math.ceil(skipAfter - at))}`}
        </button>
      )}
    </section>
  );
}
