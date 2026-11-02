import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { FeedPostView } from "@truman3/ui";
import { useDeferredValue, useEffect, useState } from "react";
import { get, type PreviewInfo, type PreviewResponse } from "../api.ts";
import { describeTime, postsPerBar, postsThatNeverAppear } from "../timeline.ts";

const SLIDER_STEP_MS = 5 * 60_000;
const PLAY_TICK_MS = 500;
const PLAY_STEP_MS = 30 * 60_000;

/** One condition's feed at one moment, drawn exactly as participants see it. */
function FeedColumn({
  versionId,
  condition,
  elapsedMs,
}: {
  versionId: string;
  condition: string;
  elapsedMs: number;
}) {
  const feed = useQuery({
    queryKey: ["preview", versionId, condition, elapsedMs],
    queryFn: () =>
      get<PreviewResponse>(
        `/admin/versions/${versionId}/preview?condition=${encodeURIComponent(condition)}&elapsedMs=${elapsedMs}`,
      ),
    placeholderData: keepPreviousData,
  });

  const targeting = feed.data?.targeting ?? {};
  const note = (contentId: string) => {
    const conditions = targeting[contentId];
    return conditions ? (
      <p className="mt-1 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
        Only in {conditions.join(", ")}
      </p>
    ) : null;
  };

  return (
    <section
      aria-label={`Feed in ${condition}`}
      className="w-full max-w-md min-w-0 flex-1 space-y-3"
    >
      <h2 className="font-semibold">
        {condition}{" "}
        <span className="font-normal text-stone-500">({feed.data?.posts.length ?? 0} posts)</span>
      </h2>
      {feed.data?.posts.length === 0 && (
        <p className="rounded-lg bg-white p-6 text-center text-stone-500">No posts to show.</p>
      )}
      {feed.data?.posts.map((post) => (
        <FeedPostView key={post.id} post={post} renderNote={note} />
      ))}
    </section>
  );
}

export function PreviewPage() {
  const { versionId } = useParams({ from: "/preview/$versionId" });
  const info = useQuery({
    queryKey: ["preview-info", versionId],
    queryFn: () => get<PreviewInfo>(`/admin/versions/${versionId}/preview-info`),
  });

  const [condition, setCondition] = useState<string | null>(null);
  const [compare, setCompare] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const shownElapsedMs = useDeferredValue(elapsedMs);

  const lengthMs = info.data?.lengthMs ?? 0;

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

  if (!info.data) {
    return null;
  }

  const current = condition ?? info.data.conditions[0]?.key ?? "";
  const settings = info.data.conditions.find(({ key }) => key === current);
  const { counts } = postsPerBar(info.data.posts, current, lengthMs);
  const tallest = Math.max(1, ...counts);
  const hidden = postsThatNeverAppear(
    info.data.posts,
    current,
    lengthMs,
    settings?.windowHours ?? null,
  );

  const select = "rounded border border-stone-300 bg-white px-2 py-1";

  return (
    <div>
      <div className="sticky top-0 z-20 border-b border-stone-200 bg-white p-3 shadow-sm">
        <div className="mx-auto max-w-5xl space-y-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h1 className="mr-auto font-semibold">
              {info.data.title}{" "}
              <span className="font-normal text-stone-500">v{info.data.version}</span>
            </h1>
            <div className="flex items-center gap-2 text-sm">
              <label htmlFor="preview-condition">Condition</label>
              <select
                id="preview-condition"
                value={current}
                onChange={(event) => setCondition(event.target.value)}
                className={select}
              >
                {info.data.conditions.map(({ key }) => (
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
                {info.data.conditions
                  .filter(({ key }) => key !== current)
                  .map(({ key }) => (
                    <option key={key}>{key}</option>
                  ))}
              </select>
            </div>
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
                {hidden} posts in this condition can never appear: they're outside the feed window
                at the start, or timed after the study ends.
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="mx-auto flex max-w-5xl items-start justify-center gap-4 p-3">
        <FeedColumn versionId={versionId} condition={current} elapsedMs={shownElapsedMs} />
        {compare && compare !== current && (
          <FeedColumn versionId={versionId} condition={compare} elapsedMs={shownElapsedMs} />
        )}
      </div>
    </div>
  );
}
