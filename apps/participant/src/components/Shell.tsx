import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { PageHeader, type PageLink, PlatformProvider } from "@truman3/ui";
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

  const links: PageLink[] = [
    ...(flow.features.spaces
      ? [
          {
            key: "spaces",
            label: "Communities",
            render: (className: string) => (
              <Link to="/spaces" className={className}>
                Communities
              </Link>
            ),
          },
        ]
      : []),
    ...(flow.features.notifications
      ? [
          {
            key: "notifications",
            label: "Notifications",
            render: (className: string) => (
              <Link
                to="/notifications"
                className={`relative ${className}`}
                aria-label={`Notifications, ${unread} new`}
              >
                Notifications
                {unread > 0 && (
                  <span className="ml-1 rounded-full bg-rose-600 px-1.5 py-0.5 text-xs text-white">
                    {unread}
                  </span>
                )}
              </Link>
            ),
          },
        ]
      : []),
    ...(me.data
      ? [
          {
            key: "profile",
            label: "Profile",
            render: (className: string) => (
              <Link to="/u/$username" params={{ username: me.data.username }} className={className}>
                Profile
              </Link>
            ),
          },
        ]
      : []),
  ];

  return (
    <PlatformProvider platform={flow}>
      <div className="min-h-dvh">
        <PageHeader
          renderBrand={(className) => (
            <Link to="/" className={className}>
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
          )}
          home={{
            key: "home",
            label: "Home",
            render: (className) => (
              <Link to="/" className={className}>
                Home
              </Link>
            ),
          }}
          links={links}
          action={
            flow.canFinish ? (
              <button
                type="button"
                onClick={() => finish.mutate()}
                disabled={finish.isPending}
                className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white"
              >
                Finish
              </button>
            ) : undefined
          }
        />
        <main className="mx-auto max-w-6xl pb-16 sm:px-3 sm:pt-4">
          <Outlet />
        </main>
      </div>
    </PlatformProvider>
  );
}
