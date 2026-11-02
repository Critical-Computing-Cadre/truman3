import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { CommentBox, CreatePostBar, FeedPostView } from "@truman3/ui";
import { get, type PreviewInfo, type PreviewResponse } from "../api.ts";
import { TimelineControls, useTimeline } from "../components/TimelineControls.tsx";

/** Stands in for a participant, who'd see their own picture on these. */
const VIEWER = "a participant";

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
      <CreatePostBar seed={VIEWER} pictureUrl={null} showPhoto={true} />
      {feed.data?.posts.length === 0 && (
        <p className="rounded-lg bg-white p-6 text-center text-stone-500">No posts to show.</p>
      )}
      {feed.data?.posts.map((post) => (
        <FeedPostView
          key={post.id}
          post={post}
          renderNote={note}
          belowComments={<CommentBox seed={VIEWER} pictureUrl={null} />}
        />
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
  const timeline = useTimeline(info.data?.lengthMs ?? 0);

  if (!info.data) {
    return null;
  }

  const current = timeline.condition ?? info.data.conditions[0]?.key ?? "";

  return (
    <div>
      <TimelineControls
        title={
          <>
            {info.data.title}{" "}
            <span className="font-normal text-stone-500">v{info.data.version}</span>
          </>
        }
        conditions={info.data.conditions}
        posts={info.data.posts}
        lengthMs={info.data.lengthMs}
        timeline={timeline}
        current={current}
      />
      <div className="mx-auto flex max-w-5xl items-start justify-center gap-4 p-3">
        <FeedColumn versionId={versionId} condition={current} elapsedMs={timeline.shownElapsedMs} />
        {timeline.compare && timeline.compare !== current && (
          <FeedColumn
            versionId={versionId}
            condition={timeline.compare}
            elapsedMs={timeline.shownElapsedMs}
          />
        )}
      </div>
    </div>
  );
}
