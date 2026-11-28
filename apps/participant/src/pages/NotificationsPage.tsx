import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Avatar, shortTime } from "@truman3/ui";
import { useEffect, useRef, useState } from "react";
import { flowQuery, get, type NotificationItem, post } from "../api.ts";
import { InboxTabs } from "../components/InboxTabs.tsx";
import { useListLook } from "../components/list-look.ts";
import { filtersFor, type NotificationFilter, showsUnder } from "../notification-filters.ts";
import { rememberOpenedFrom, track } from "../tracking.ts";

function describe(item: NotificationItem): string {
  const [first] = item.actors;
  const others = item.actors.length - 1;
  const who =
    others > 0 ? `${first?.name} and ${others} other${others > 1 ? "s" : ""}` : first?.name;

  switch (item.type) {
    case "read":
      return `${who} read your ${item.targetKind}`;
    case "like":
      return `${who} liked your ${item.targetKind}`;
    case "reply":
      return `${who} replied: ${item.replyBody ?? ""}`;
    case "remove":
      return item.targetIsTheirs
        ? `${who} removed your ${item.targetKind}`
        : `${who} removed ${item.targetName}'s ${item.targetKind}, which you flagged`;
    case "answer":
      return item.targetKind === "person"
        ? `${who} looked at your report of ${item.targetName}`
        : `${who} looked at ${item.targetName}'s ${item.targetKind}, which you flagged`;
    case "ban":
      return `${who} banned ${item.targetName}, whom you reported`;
    case "repost":
      return `${who} reposted your ${item.targetKind}`;
    case "follow":
      return `${who} followed you`;
    case "tag":
      return `${who} tagged you in a post`;
    case "approve":
      return `${who} approved your ${item.targetKind}`;
    case "uphold":
      return item.appealOf === "label"
        ? `${who} looked at your appeal, and the label on your ${item.targetKind} stays`
        : `${who} looked at your appeal, and your ${item.targetKind} stays removed`;
    case "restore":
      return item.appealOf === "label"
        ? `${who} looked at your appeal, and took the label off your ${item.targetKind}`
        : `${who} looked at your appeal, and put your ${item.targetKind} back`;
    case "label":
      return `${who} labeled your ${item.targetKind} "${item.reason ?? ""}"`;
    case "warn":
      return `${who} warned you about your ${item.targetKind}`;
  }
}

export function NotificationsPage() {
  const client = useQueryClient();
  const flow = useQuery(flowQuery);
  const marked = useRef(false);
  // Only a platform with a page for each post has somewhere to send someone.
  const pages = flow.data?.features.postPages ?? false;

  const list = useQuery({
    queryKey: ["notifications"],
    queryFn: () => get<{ notifications: NotificationItem[] }>("/notifications"),
  });

  const markViewed = useMutation({
    mutationFn: () => post("/notifications/viewed"),
    onSuccess: () => client.invalidateQueries({ queryKey: ["me"] }),
  });
  const { mutate } = markViewed;

  // Once, on arriving, so what was new stays highlighted until they leave.
  useEffect(() => {
    if (!marked.current) {
      marked.current = true;
      mutate();
    }
  }, [mutate]);

  const all = list.data?.notifications ?? [];
  const look = useListLook();
  // Chips above the list narrow it to one kind, as apps let people (ADR 107). Each press is
  // recorded. Nothing is asked of the server: it's the same list with some left out.
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const filters = filtersFor(all);
  const shown = filters.some(({ key }) => key === filter) ? filter : "all";
  const items = all.filter((item) => showsUnder(shown, item));
  const choose = (next: NotificationFilter) => {
    setFilter(next);
    track({ type: "notifications.filtered", payload: { filter: next } });
  };

  return (
    <div className={`mx-auto max-w-xl ${look.frame}`}>
      <InboxTabs here="notifications" />
      <h1 className={look.heading}>Notifications</h1>
      {filters.length > 0 && (
        // biome-ignore lint/a11y/useSemanticElements: a fieldset would draw a box around the chips
        <div
          role="group"
          aria-label="Show"
          className="flex gap-2 overflow-x-auto px-3 pb-3 [scrollbar-width:none]"
        >
          {filters.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              aria-pressed={shown === key}
              onClick={() => choose(key)}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium ${
                shown === key
                  ? "border-transparent bg-stone-900 text-white"
                  : "border-stone-300 text-stone-700 hover:bg-stone-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {list.data && items.length === 0 && (
        <p className="p-6 text-center text-stone-500">Nothing yet.</p>
      )}
      <ul className="divide-y divide-stone-200">
        {items.map((item) => (
          <li key={item.key} className={`flex gap-3 p-3 ${item.unread ? look.unread : ""}`}>
            <Avatar
              seed={item.actors[0]?.username ?? ""}
              url={item.actors[0]?.pictureUrl ?? null}
            />
            <div className="min-w-0 flex-1">
              {pages && item.postId ? (
                <Link
                  to="/p/$postId"
                  params={{ postId: item.postId }}
                  {...(item.commentId ? { hash: `comment-${item.commentId}` } : {})}
                  onClick={() => rememberOpenedFrom("notifications")}
                  className="block break-words underline-offset-2 hover:underline"
                >
                  {describe(item)}
                </Link>
              ) : (
                <p className="break-words">{describe(item)}</p>
              )}
              {item.targetBody && (
                <p className="truncate text-sm text-stone-500">"{item.targetBody}"</p>
              )}
              {/* A label is already in the line above. */}
              {item.reason && item.type !== "label" && (
                <p className="break-words text-sm">
                  {item.type === "remove" || item.type === "ban"
                    ? `Reason: ${item.reason}`
                    : item.reason}
                </p>
              )}
              <p className="text-xs text-stone-500">{shortTime(item.at)}</p>
            </div>
            {/* A dot for what's new, on every kind, since a photo app has no band of color for it. */}
            {item.unread && (
              <span
                data-testid="unread-dot"
                aria-hidden="true"
                className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent-fill"
              />
            )}
            {item.targetImageUrl && (
              <img src={item.targetImageUrl} alt="" className="h-12 w-12 rounded object-cover" />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
