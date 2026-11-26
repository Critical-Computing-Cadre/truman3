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
  /** Whether captions were showing, for a video that has them. */
  captionsOn?: boolean;
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
      if (byViewer) {
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
    /** Counting time again, for a video that kept playing while it wasn't counted. */
    resumed: () => {
      if (playingSince === null) {
        playingSince = now();
      }
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
      // Anything counted is worth sending, even a pause with no playing since the last report.
      const happened =
        taken.playedMs > 0 ||
        taken.plays > 0 ||
        taken.pauses > 0 ||
        taken.seeks > 0 ||
        taken.ended > 0;
      return happened ? taken : null;
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
  /** Whether captions show, on videos that have them. On until they turn them off (ADR 101). */
  captions: boolean;
}
let sound: VideoSound = { on: false, started: true, captions: true };
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
    setCaptions: (captions: boolean) => setSound({ captions }),
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
/**
 * Said when a video on a watch page ends, so the page can go on to the next one (ADR 96). The
 * participant app gives one there. Elsewhere a video just stops.
 */
export const VideoEndedContext = createContext<(() => void) | null>(null);

export function PostVideo({
  video,
  autoplay = false,
  watch = false,
}: {
  video: Video;
  autoplay?: boolean;
  /**
   * The video a watch page is for (ADR 96). It starts as the page opens, with sound if the
   * browser allows, and keeps playing while they scroll down to the comments.
   */
  watch?: boolean;
}) {
  const ended = useRef(useContext(VideoEndedContext));
  ended.current = useContext(VideoEndedContext);
  const ref = useRef<HTMLVideoElement>(null);
  // Kept in a ref, so a new reporting function doesn't start the count again part way through.
  const report = useRef(useContext(VideoWatchingContext));
  report.current = useContext(VideoWatchingContext);
  const shared = useVideoSound();
  const onScreen = useRef(false);
  const [pausedByViewer, setPausedByViewer] = useState(false);
  const viewerPaused = useRef(false);
  /** Set by a tap that pauses it, so that pause is counted as the viewer's, whatever else happens. */
  const viewerPausing = useRef(false);
  /** The count of this spell of watching, so a tap can add a pause to it directly. */
  const counting = useRef<ReturnType<typeof createWatchMeter> | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const meter = createWatchMeter(video.seconds ?? 0);
    counting.current = meter;
    const send = () => {
      const taken = meter.take();
      if (taken && report.current) {
        const [captions] = element.textTracks;
        report.current({
          ...taken,
          seconds: element.duration || taken.seconds,
          ...(captions ? { captionsOn: captions.mode === "showing" } : {}),
        });
      }
    };
    // Pauses the browser makes itself, at the end or when it's scrolled away, aren't the viewer's.
    let pausingOurselves = false;
    const listeners: [string, () => void][] = [
      ["playing", () => meter.playing()],
      [
        "pause",
        () => {
          // Where it plays by itself, only a tap pauses it. Elsewhere it's the browser's controls.
          meter.paused(autoplay ? viewerPausing.current : !pausingOurselves && !element.ended);
          pausingOurselves = false;
          viewerPausing.current = false;
        },
      ],
      [
        "ended",
        () => {
          meter.ended();
          // Sent as it ends, so a beat waiting for the end can happen then (ADR 100).
          send();
          ended.current?.();
        },
      ],
      ["timeupdate", () => meter.at(element.currentTime)],
      // A looping video seeks back to its start by itself, which is once through, not a seek. One
      // that plays by itself has no controls, so the viewer can't seek it.
      [
        "seeked",
        () => {
          if (element.loop) {
            meter.looped();
            send();
          } else {
            meter.sought();
          }
        },
      ],
      ["volumechange", () => meter.sound(!element.muted && element.volume > 0)],
    ];
    meter.sound(!element.muted && element.volume > 0);
    for (const [name, listener] of listeners) {
      element.addEventListener(name, listener);
    }
    // Counting may start while it's already playing, with no "playing" event to come.
    if (!element.paused) {
      meter.playing();
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) {
          return;
        }
        const showing = entry.intersectionRatio >= (autoplay ? PLAYS_AT : ON_SCREEN);
        onScreen.current = showing;
        // A watch page's video keeps going below the fold, as on these sites.
        if (showing || watch) {
          if (autoplay && sound.started && !viewerPaused.current) {
            element.play().catch(() => {});
          }
          return;
        }
        if (!element.paused) {
          pausingOurselves = true;
          element.pause();
        }
        // The clock stops now, not when the browser gets round to saying it's paused, so a second
        // report straight after this one has nothing in it.
        meter.paused(false);
        send();
      },
      { threshold: [0, ON_SCREEN, PLAYS_AT, 1] },
    );
    observer.observe(element);
    // A watch page starts its video, with sound if the click that opened it allows that, or
    // without if the browser says no.
    if (watch) {
      element.play().catch(() => {
        element.muted = true;
        element.play().catch(() => {});
      });
    }
    // Time with the page hidden isn't watching. Coming back to one still playing starts the
    // clock again, without counting another play.
    const onHidden = () => {
      if (document.visibilityState === "hidden") {
        meter.paused(false);
        send();
      } else if (!element.paused) {
        meter.resumed();
      }
    };
    const onLeave = () => {
      meter.paused(false);
      send();
    };
    // Ahead of the participant app's own listener, which sends what's waiting as the page closes,
    // so this last report goes with it. Listeners that capture run first.
    document.addEventListener("visibilitychange", onHidden, { capture: true });
    window.addEventListener("pagehide", onLeave, { capture: true });

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onHidden, { capture: true });
      window.removeEventListener("pagehide", onLeave, { capture: true });
      for (const [name, listener] of listeners) {
        element.removeEventListener(name, listener);
      }
      send();
    };
  }, [video.seconds, autoplay, watch]);

  // React doesn't keep `muted` in step with the element, so it's set here.
  useEffect(() => {
    const element = ref.current;
    if (!element || !autoplay) {
      return;
    }
    element.muted = !shared.on;
    const [captions] = element.textTracks;
    if (captions) {
      captions.mode = shared.captions ? "showing" : "hidden";
    }
    if (shared.started && onScreen.current && !viewerPaused.current && element.paused) {
      element.play().catch(() => {});
    }
  }, [autoplay, shared.on, shared.started, shared.captions]);

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
        style={{ aspectRatio: watch ? "16 / 9" : shape }}
        className={`w-full bg-[#000] object-contain ${watch ? "max-h-[75vh] sm:rounded-xl" : "max-h-[80vh]"}`}
      >
        {video.captionsUrl && (
          <track kind="captions" src={video.captionsUrl} srcLang="en" label="Captions" default />
        )}
      </video>
    );
  }

  const togglePlaying = () => {
    const element = ref.current;
    if (!element) {
      return;
    }
    // What the button says decides, not whether it happens to be playing: it may have stopped
    // itself for a moment, such as when typing a comment moves the page.
    if (viewerPaused.current) {
      viewerPaused.current = false;
      setPausedByViewer(false);
      element.play().catch(() => {});
      return;
    }
    viewerPaused.current = true;
    setPausedByViewer(true);
    if (element.paused) {
      counting.current?.paused(true);
    } else {
      viewerPausing.current = true;
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
      >
        {video.captionsUrl && (
          <track kind="captions" src={video.captionsUrl} srcLang="en" label="Captions" default />
        )}
      </video>
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
      {video.captionsUrl && (
        <button
          type="button"
          onClick={() => shared.setCaptions(!shared.captions)}
          aria-pressed={shared.captions}
          className={`absolute top-28 left-3 rounded-full px-3 py-1.5 text-sm font-semibold ${
            shared.captions ? "bg-[#fff] text-[#000]" : "bg-[#000]/55 text-[#fff]"
          }`}
        >
          Captions
        </button>
      )}
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
