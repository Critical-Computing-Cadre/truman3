import type { FeedAttachment } from "@truman3/core";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

type Video = Extract<FeedAttachment, { type: "video" }>;

/** One spell of watching, as the `video.watched` event records it (ADR 94). */
export interface VideoWatching {
  playedMs: number;
  seconds: number;
  furthestSeconds: number;
  ended: number;
  plays: number;
  pauses: number;
  seeks: number;
  soundOn: boolean;
}

/**
 * Keeps count of how someone watches one video. It's told what the player does, and `take` hands
 * over what's happened since it was last asked, or null if nothing has.
 */
export function createWatchMeter(seconds: number, now: () => number = Date.now) {
  let playingSince: number | null = null;
  let counts = { playedMs: 0, furthestSeconds: 0, ended: 0, plays: 0, pauses: 0, seeks: 0 };
  let soundOn = false;
  let soundEverOn = false;

  const stopClock = () => {
    if (playingSince !== null) {
      counts.playedMs += now() - playingSince;
      playingSince = null;
    }
  };

  return {
    playing: () => {
      if (playingSince === null) {
        playingSince = now();
        counts.plays += 1;
        soundEverOn ||= soundOn;
      }
    },
    /** A pause the viewer made. Reaching the end, or scrolling away, isn't one. */
    paused: (byViewer: boolean) => {
      if (playingSince !== null && byViewer) {
        counts.pauses += 1;
      }
      stopClock();
    },
    ended: () => {
      stopClock();
      counts.ended += 1;
    },
    at: (position: number) => {
      counts.furthestSeconds = Math.max(counts.furthestSeconds, position);
    },
    /** Played through and started again by itself, without stopping. */
    looped: () => {
      counts.ended += 1;
    },
    sought: () => {
      counts.seeks += 1;
    },
    sound: (on: boolean) => {
      soundOn = on;
      if (on && playingSince !== null) {
        soundEverOn = true;
      }
    },
    take: (): VideoWatching | null => {
      const running = playingSince !== null;
      stopClock();
      const taken = { ...counts, seconds, soundOn: soundEverOn };
      counts = { playedMs: 0, furthestSeconds: 0, ended: 0, plays: 0, pauses: 0, seeks: 0 };
      soundEverOn = running && soundOn;
      if (running) {
        playingSince = now();
      }
      return taken.playedMs > 0 || taken.plays > 0 ? taken : null;
    },
  };
}

/**
 * Where watching is reported. The participant app gives one. Without it, as in the admin app's
 * preview, a video plays and nothing is recorded.
 */
export const VideoWatchingContext = createContext<((report: VideoWatching) => void) | null>(null);

/** Counts as on screen once this much of it is. */
const ON_SCREEN = 0.5;
/** A video that plays by itself starts once it's mostly on screen, so only one plays at a time. */
const PLAYS_AT = 0.6;

/**
 * Sound for videos that play by themselves, the same for every one on the page (ADR 95). Browsers
 * only allow sound after someone taps, so it starts off, and a tap turns it on for the rest of their
 * visit. `started` is false only while a study that asks for a tap first is waiting for it.
 */
interface VideoSound {
  on: boolean;
  started: boolean;
}
let sound: VideoSound = { on: false, started: true };
const soundListeners = new Set<() => void>();
const setSound = (next: Partial<VideoSound>) => {
  sound = { ...sound, ...next };
  for (const listener of soundListeners) {
    listener();
  }
};
const subscribeSound = (listener: () => void) => {
  soundListeners.add(listener);
  return () => soundListeners.delete(listener);
};

/** The sound shared by videos that play by themselves, and ways to change it. */
export function useVideoSound() {
  const state = useSyncExternalStore(
    subscribeSound,
    () => sound,
    () => sound,
  );
  return {
    ...state,
    setOn: (on: boolean) => setSound({ on }),
    /** The tap a study asked for before the first video. Sound is on from then. */
    start: () => setSound({ started: true, on: true }),
    /** For a study that asks for a tap first. Nothing plays until there's been one. */
    waitForTap: () => {
      if (!sound.on) {
        setSound({ started: false });
      }
    },
  };
}

/**
 * A post's video. By default it has the browser's own controls, and stops when it's scrolled away,
 * as on most sites. With `autoplay`, as on a short-video site, it plays by itself while it's on
 * screen, loops, and a tap pauses it (ADR 95). Each spell of watching is reported when it ends.
 */
export function PostVideo({ video, autoplay = false }: { video: Video; autoplay?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const report = useContext(VideoWatchingContext);
  const shared = useVideoSound();
  const onScreen = useRef(false);
  const [pausedByViewer, setPausedByViewer] = useState(false);
  const viewerPaused = useRef(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const meter = createWatchMeter(video.seconds ?? 0);
    const send = () => {
      const taken = meter.take();
      if (taken && report) {
        report({ ...taken, seconds: element.duration || taken.seconds });
      }
    };
    // Pauses the browser makes itself, at the end or when it's scrolled away, aren't the viewer's.
    let pausingOurselves = false;
    const listeners: [string, () => void][] = [
      ["playing", () => meter.playing()],
      [
        "pause",
        () => {
          meter.paused(!pausingOurselves && !element.ended);
          pausingOurselves = false;
        },
      ],
      ["ended", () => meter.ended()],
      ["timeupdate", () => meter.at(element.currentTime)],
      // A looping video seeks back to its start by itself, which is once through, not a seek. One
      // that plays by itself has no controls, so the viewer can't seek it.
      ["seeked", () => (element.loop ? meter.looped() : meter.sought())],
      ["volumechange", () => meter.sound(!element.muted && element.volume > 0)],
    ];
    meter.sound(!element.muted && element.volume > 0);
    for (const [name, listener] of listeners) {
      element.addEventListener(name, listener);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) {
          return;
        }
        const showing = entry.intersectionRatio >= (autoplay ? PLAYS_AT : ON_SCREEN);
        onScreen.current = showing;
        if (showing) {
          if (autoplay && sound.started && !viewerPaused.current) {
            element.play().catch(() => {});
          }
          return;
        }
        if (!element.paused) {
          pausingOurselves = true;
          element.pause();
        }
        send();
      },
      { threshold: [0, ON_SCREEN, PLAYS_AT, 1] },
    );
    observer.observe(element);
    const onHidden = () => {
      if (document.visibilityState === "hidden") {
        send();
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", send);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", send);
      for (const [name, listener] of listeners) {
        element.removeEventListener(name, listener);
      }
      send();
    };
  }, [report, video.seconds, autoplay]);

  // React doesn't keep `muted` in step with the element, so it's set here.
  useEffect(() => {
    const element = ref.current;
    if (!element || !autoplay) {
      return;
    }
    element.muted = !shared.on;
    if (shared.started && onScreen.current && !viewerPaused.current && element.paused) {
      element.play().catch(() => {});
    }
  }, [autoplay, shared.on, shared.started]);

  if (!autoplay) {
    const shape = video.width && video.height ? `${video.width} / ${video.height}` : "16 / 9";
    return (
      // biome-ignore lint/a11y/useMediaCaption: researchers' videos have no captions yet (ADR 94)
      <video
        ref={ref}
        src={video.url}
        poster={video.posterUrl}
        controls
        playsInline
        preload="metadata"
        aria-label="Video"
        style={{ aspectRatio: shape }}
        className="max-h-[80vh] w-full bg-[#000] object-contain"
      />
    );
  }

  const togglePlaying = () => {
    const element = ref.current;
    if (!element) {
      return;
    }
    if (element.paused) {
      viewerPaused.current = false;
      setPausedByViewer(false);
      element.play().catch(() => {});
    } else {
      viewerPaused.current = true;
      setPausedByViewer(true);
      element.pause();
    }
  };
  return (
    <div className="relative h-full w-full">
      <video
        ref={ref}
        src={video.url}
        poster={video.posterUrl}
        loop
        muted
        playsInline
        preload="metadata"
        aria-label="Video"
        className={`h-full w-full bg-[#000] ${
          // A tall video fills the screen, as on these apps. A wide one is shown whole.
          (video.height ?? 0) > (video.width ?? 0) ? "object-cover" : "object-contain"
        }`}
      />
      <button
        type="button"
        aria-label={pausedByViewer ? "Play" : "Pause"}
        onClick={togglePlaying}
        className="absolute inset-0 flex items-center justify-center"
      >
        {pausedByViewer && (
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-20 w-20 fill-[#fff]/80">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
      {video.hasSound !== false && (
        <button
          type="button"
          onClick={() => shared.setOn(!shared.on)}
          aria-pressed={shared.on}
          className="absolute top-16 left-3 flex items-center gap-1.5 rounded-full bg-[#000]/55 px-3 py-1.5 text-sm font-semibold text-[#fff]"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="h-4 w-4"
          >
            <path d="M4 9v6h4l5 4V5L8 9z" />
            {shared.on ? (
              <path d="M16 9a4 4 0 0 1 0 6M18.500 6.500a8 8 0 0 1 0 11" />
            ) : (
              <path d="M17 9l5 6M22 9l-5 6" />
            )}
          </svg>
          {shared.on ? <span className="sr-only">Sound on</span> : "Tap for sound"}
        </button>
      )}
    </div>
  );
}
