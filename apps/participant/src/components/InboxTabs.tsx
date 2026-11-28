import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { usePlatform } from "@truman3/ui";
import { flowQuery, meQuery } from "../api.ts";

/**
 * On a forum on a phone, notifications and messages share one tab along the bottom, "Inbox", as on
 * these apps (ADR 107). This is the pair of tabs at the top of both pages that moves between them.
 * Anywhere else each has its own place in the menu, and this draws nothing.
 */
export function InboxTabs({ here }: { here: "notifications" | "messages" }) {
  const { layout } = usePlatform();
  const flow = useQuery(flowQuery);
  const me = useQuery(meQuery);
  const both = flow.data?.features.notifications && flow.data.features.messages;
  if (layout !== "forum" || !both) {
    return null;
  }
  const tab = (current: boolean) =>
    `flex flex-1 items-center justify-center gap-1.5 border-b-2 py-3 text-sm font-semibold ${
      current ? "border-accent text-accent" : "border-transparent text-stone-500"
    }`;
  const count = (value: number | undefined) =>
    value ? (
      <span className="rounded-full bg-rose-600 px-1.5 text-[0.65rem] leading-4 text-white">
        {value}
      </span>
    ) : null;
  return (
    <nav aria-label="Inbox" className="flex border-b border-stone-200 md:hidden">
      <Link
        to="/notifications"
        className={tab(here === "notifications")}
        {...(here === "notifications" ? { "aria-current": "page" as const } : {})}
      >
        Notifications
        {here !== "notifications" && count(me.data?.unreadNotifications)}
      </Link>
      <Link
        to="/messages"
        className={tab(here === "messages")}
        {...(here === "messages" ? { "aria-current": "page" as const } : {})}
      >
        Messages
        {here !== "messages" && count(me.data?.unreadMessages)}
      </Link>
    </nav>
  );
}
