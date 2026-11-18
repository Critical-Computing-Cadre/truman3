import type { FeedAttachment } from "@truman3/core";
import { createContext, useContext, useEffect, useRef } from "react";

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

/** Counts as on screen once half of it is. */
const ON_SCREEN = 0.5;

/**
 * A post's video, with the browser's own controls. It stops when it's scrolled away, as on real
 * sites, and each spell of watching is reported then.
 */
export function PostVideo({ video }: { video: Video }) {
  const ref = useRef<HTMLVideoElement>(null);
  const report = useContext(VideoWatchingContext);

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
      ["seeked", () => meter.sought()],
      ["volumechange", () => meter.sound(!element.muted && element.volume > 0)],
    ];
    meter.sound(!element.muted && element.volume > 0);
    for (const [name, listener] of listeners) {
      element.addEventListener(name, listener);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry && !entry.isIntersecting) {
          if (!element.paused) {
            pausingOurselves = true;
            element.pause();
          }
          send();
        }
      },
      { threshold: ON_SCREEN },
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
  }, [report, video.seconds]);

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
      className="max-h-[80vh] w-full bg-black object-contain"
    />
  );
}
