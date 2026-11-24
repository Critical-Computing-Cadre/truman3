import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FeedAuthor } from "@truman3/core";
import { countWords } from "@truman3/ui";
import { get, post as send } from "../api.ts";

interface Channel {
  isViewer: boolean;
  following: boolean;
  followerCount?: number;
}

/**
 * Subscribe, beside a channel's name on a video site's watch page (ADR 96). It's following the
 * author, recorded as following always is, and shows how many subscribers they have.
 */
export function SubscribeButton({ author }: { author: FeedAuthor }) {
  const client = useQueryClient();
  const path = `/actors/${encodeURIComponent(author.username)}`;
  const channel = useQuery({
    queryKey: ["actor", author.username],
    queryFn: () => get<Channel>(path),
  });
  const relate = useMutation({
    mutationFn: (action: "follow" | "unfollow") => send(`${path}/relation`, { action }),
    onSettled: () => client.invalidateQueries({ queryKey: ["actor", author.username] }),
  });
  if (!channel.data || channel.data.isViewer) {
    return null;
  }
  const { following, followerCount } = channel.data;
  return (
    <span className="flex items-center gap-3">
      {followerCount !== undefined && (
        <span className="text-xs text-stone-600">{countWords(followerCount)} subscribers</span>
      )}
      <button
        type="button"
        aria-pressed={following}
        disabled={relate.isPending}
        onClick={() => relate.mutate(following ? "unfollow" : "follow")}
        className={`rounded-full px-4 py-2 text-sm font-semibold ${
          following ? "bg-stone-100 text-stone-900" : "bg-stone-900 text-white"
        }`}
      >
        {following ? "Subscribed" : "Subscribe"}
      </button>
    </span>
  );
}
