import { useDeferredValue, useEffect, useState } from "react";
import type { PreviewInfo } from "../api.ts";
import { describeTime, postsPerBar, postsThatNeverAppear } from "../timeline.ts";

const SLIDER_STEP_MS = 5 * 60_000;
const PLAY_TICK_MS = 500;
const PLAY_STEP_MS = 30 * 60_000;

/** Where a researcher is looking: which condition, what to compare it with, and when. */
export function useTimeline(lengthMs: number) {
  const [condition, setCondition] = useState<string | null>(null);
  const [compare, setCompare] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const shownElapsedMs = useDeferredValue(elapsedMs);

  useEffect(() => {
    if (!playing) {
      return;
    }
    const timer = setInterval(() => {
      setElapsedMs((current) => {
        const next = current + PLAY_STEP_MS;
        if (next >= lengthMs) {
          setPlaying(false);
          return lengthMs;
        }
        return next;
      });
    }, PLAY_TICK_MS);
    return () => clearInterval(timer);
  }, [playing, lengthMs]);

  return {
    condition,
    setCondition,
    compare,
    setCompare,
    elapsedMs,
    setElapsedMs,
    shownElapsedMs,
    playing,
    setPlaying,
  };
}

export type Timeline = ReturnType<typeof useTimeline>;

export function TimelineControls({
  title,
  conditions,
  posts,
  lengthMs,
  timeline,
  current,
  extra,
}: {
  title: React.ReactNode;
  conditions: PreviewInfo["conditions"];
  posts: PreviewInfo["posts"];
  lengthMs: number;
  timeline: Timeline;
  current: string;
  extra?: React.ReactNode;
}) {
  const { compare, setCompare, setCondition, elapsedMs, setElapsedMs, playing, setPlaying } =
    timeline;
  const settings = conditions.find(({ key }) => key === current);
  const { counts } = postsPerBar(posts, current, lengthMs);
  const tallest = Math.max(1, ...counts);
  const hidden = postsThatNeverAppear(posts, current, lengthMs, settings?.windowHours ?? null);

  const select = "rounded border border-stone-300 bg-white px-2 py-1";

  return (
    <div className="sticky top-0 z-20 border-b border-stone-200 bg-white p-3 shadow-sm">
      <div className="mx-auto max-w-5xl space-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="mr-auto font-semibold">{title}</h1>
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="preview-condition">Condition</label>
            <select
              id="preview-condition"
              value={current}
              onChange={(event) => setCondition(event.target.value)}
              className={select}
            >
              {conditions.map(({ key }) => (
                <option key={key}>{key}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="preview-compare">Compare with</label>
            <select
              id="preview-compare"
              value={compare ?? ""}
              onChange={(event) => setCompare(event.target.value || null)}
              className={select}
            >
              <option value="">Nothing</option>
              {conditions
                .filter(({ key }) => key !== current)
                .map(({ key }) => (
                  <option key={key}>{key}</option>
                ))}
            </select>
          </div>
          {extra}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (!playing && elapsedMs >= lengthMs) {
                setElapsedMs(0);
              }
              setPlaying(!playing);
            }}
            className="w-16 rounded bg-stone-900 py-1 text-sm text-white"
          >
            {playing ? "Pause" : "Play"}
          </button>
          <div className="min-w-0 flex-1">
            <div aria-hidden="true" className="flex h-8 items-end gap-px">
              {counts.map((count, index) => (
                <div
                  // The bars are positions on a timeline, which don't change order.
                  // biome-ignore lint/suspicious/noArrayIndexKey: see above
                  key={index}
                  className="min-h-px flex-1 bg-stone-400"
                  style={{ height: `${(count / tallest) * 100}%` }}
                />
              ))}
            </div>
            <input
              type="range"
              aria-label="Time in the study"
              min={0}
              max={lengthMs}
              step={SLIDER_STEP_MS}
              value={elapsedMs}
              onChange={(event) => {
                setPlaying(false);
                setElapsedMs(Number(event.target.value));
              }}
              className="block w-full"
            />
          </div>
          <output className="w-32 text-right text-sm tabular-nums">
            {describeTime(elapsedMs)}
          </output>
        </div>

        <p className="text-xs text-stone-600">
          Bars show new posts over time.{" "}
          {hidden > 0 && (
            <span className="font-medium text-amber-800">
              {hidden} posts in this condition can never appear: they're outside the feed window at
              the start, or timed after the study ends.
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
