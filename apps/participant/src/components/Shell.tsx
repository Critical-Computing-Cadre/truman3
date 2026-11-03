import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { PlatformProvider } from "@truman3/ui";
import { type FlowState, meQuery, post } from "../api.ts";
import { flushTracking } from "../tracking.ts";

const POLL_EVERY_MS = 30_000;

/** The header and page around everything once someone's in the feed. */
export function Shell({ flow, onAdvanced }: { flow: FlowState; onAdvanced: () => void }) {
  const me = useQuery({ ...meQuery, refetchInterval: POLL_EVERY_MS });
  const unread = me.data?.unreadNotifications ?? 0;

  const finish = useMutation({
    mutationFn: () => {
      flushTracking();
      return post("/me/flow/advance", { position: flow.position });
    },
    onSuccess: onAdvanced,
  });

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-white">
        <nav className="mx-auto flex max-w-6xl items-center gap-4 px-3 py-2">
          <Link to="/" className="mr-auto flex min-w-0 items-center gap-2 font-semibold">
            {flow.site.logoUrl ? (
              <img
                src={flow.site.logoUrl}
                alt={flow.site.name}
                className="h-8 max-w-40 object-contain"
              />
            ) : (
              <span className="truncate">{flow.site.name}</span>
            )}
          </Link>
          {flow.features.notifications && (
            <Link
              to="/notifications"
              className="relative text-sm"
              aria-label={`Notifications, ${unread} new`}
            >
              Notifications
              {unread > 0 && (
                <span className="ml-1 rounded-full bg-rose-600 px-1.5 py-0.5 text-xs text-white">
                  {unread}
                </span>
              )}
            </Link>
          )}
          {me.data && (
            <Link to="/u/$username" params={{ username: me.data.username }} className="text-sm">
              Profile
            </Link>
          )}
          {flow.canFinish && (
            <button
              type="button"
              onClick={() => finish.mutate()}
              disabled={finish.isPending}
              className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white"
            >
              Finish
            </button>
          )}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl pb-16 sm:px-3 sm:pt-4">
        <PlatformProvider platform={flow}>
          <Outlet />
        </PlatformProvider>
      </main>
    </div>
  );
}
