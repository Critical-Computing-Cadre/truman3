import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Avatar, shortTime } from "@truman3/ui";
import { useEffect, useRef } from "react";
import { get, type NotificationItem, post } from "../api.ts";

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
  }
}

export function NotificationsPage() {
  const client = useQueryClient();
  const marked = useRef(false);

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

  const items = list.data?.notifications ?? [];

  return (
    <div className="mx-auto max-w-xl bg-white shadow-sm sm:rounded-lg">
      <h1 className="p-4 text-xl font-semibold">Notifications</h1>
      {list.data && items.length === 0 && (
        <p className="p-6 text-center text-stone-500">Nothing yet.</p>
      )}
      <ul className="divide-y divide-stone-200">
        {items.map((item) => (
          <li key={item.key} className={`flex gap-3 p-3 ${item.unread ? "bg-amber-50" : ""}`}>
            <Avatar
              seed={item.actors[0]?.username ?? ""}
              url={item.actors[0]?.pictureUrl ?? null}
            />
            <div className="min-w-0 flex-1">
              <p className="break-words">{describe(item)}</p>
              {item.targetBody && (
                <p className="truncate text-sm text-stone-500">"{item.targetBody}"</p>
              )}
              <p className="text-xs text-stone-500">{shortTime(item.at)}</p>
            </div>
            {item.targetImageUrl && (
              <img src={item.targetImageUrl} alt="" className="h-12 w-12 rounded object-cover" />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
