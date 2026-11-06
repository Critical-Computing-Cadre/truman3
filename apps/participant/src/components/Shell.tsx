import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import type { FeedWarning } from "@truman3/core";
import {
  LinkIcon,
  PageHeader,
  type PageLink,
  PlatformProvider,
  type TextLinks,
  TextLinksContext,
  WarningNotice,
} from "@truman3/ui";
import { useEffect } from "react";
import { type FlowState, get, meQuery, post } from "../api.ts";
import { flushTracking } from "../tracking.ts";

const POLL_EVERY_MS = 30_000;

/** Layouts whose sections show an icon before each word. */
const ICON_LAYOUTS: string[] = ["photo", "short-posts", "classic"];

/**
 * On a platform that shows icons for its sections, an icon goes before each link's word. The link
 * stretches over the icon too, so either one can be pressed.
 */
function withIcon(link: PageLink): PageLink {
  return {
    ...link,
    render: (className) => (
      <span className="relative flex items-center">
        <LinkIcon name={link.key} className="pointer-events-none absolute left-3 h-6 w-6" />
        {link.render(`${className} pl-12 after:absolute after:inset-0`)}
      </span>
    ),
  };
}

const LINK = "font-medium text-sky-800 underline-offset-2 hover:underline";
const TEXT_LINKS: TextLinks = {
  renderTag: (tag, children) => (
    <Link to="/tags/$tag" params={{ tag }} className={LINK}>
      {children}
    </Link>
  ),
  renderMention: (username, children) => (
    <Link to="/u/$username" params={{ username }} className={LINK}>
      {children}
    </Link>
  ),
  renderPlace: (place, children) => (
    <Link to="/places/$place" params={{ place }} className="underline-offset-2 hover:underline">
      {children}
    </Link>
  ),
};

/** Puts the study's light or dark on the page, following the device if that's what it chose. */
function useTheme(theme: FlowState["theme"]) {
  useEffect(() => {
    const root = document.documentElement;
    const device = window.matchMedia?.("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "device" && Boolean(device?.matches));
      root.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    device?.addEventListener?.("change", apply);
    return () => {
      device?.removeEventListener?.("change", apply);
      root.dataset.theme = "light";
    };
  }, [theme]);
}

/** The header and page around everything once someone's in the feed. */
export function Shell({ flow, onAdvanced }: { flow: FlowState; onAdvanced: () => void }) {
  const me = useQuery({ ...meQuery, refetchInterval: POLL_EVERY_MS });
  const unread = me.data?.unreadNotifications ?? 0;
  useTheme(flow.theme);
  const client = useQueryClient();
  const warnings = useQuery({
    queryKey: ["warnings"],
    queryFn: () => get<{ warnings: FeedWarning[] }>("/warnings"),
    enabled: flow.features.warnings,
    refetchInterval: POLL_EVERY_MS,
  });
  const acknowledge = useMutation({
    mutationFn: (id: string) => post(`/warnings/${id}/acknowledge`),
    onSuccess: () => client.invalidateQueries({ queryKey: ["warnings"] }),
  });

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
    ...(flow.features.trending || flow.features.whoToFollow || flow.features.exploreGrid
      ? [
          {
            key: "explore",
            label: "Explore",
            render: (className: string) => (
              <Link to="/explore" className={className}>
                Explore
              </Link>
            ),
          },
        ]
      : []),
    // With spaces, each community's page and the list of them link here instead.
    ...(flow.features.modLog && !flow.features.spaces
      ? [
          {
            key: "mod-log",
            label: "Mod log",
            render: (className: string) => (
              <Link to="/mod-log" className={className}>
                Mod log
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
                  <span className="absolute top-0 right-0 rounded-full bg-rose-600 px-1 text-[0.65rem] leading-4 text-white">
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
          home={(ICON_LAYOUTS.includes(flow.layout) ? withIcon : (link: PageLink) => link)({
            key: "home",
            label: "Home",
            render: (className) => (
              <Link to="/" className={className}>
                Home
              </Link>
            ),
          })}
          links={ICON_LAYOUTS.includes(flow.layout) ? links.map(withIcon) : links}
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
          {(warnings.data?.warnings ?? []).map((warning) => (
            <div key={warning.id} className="mb-3">
              <WarningNotice warning={warning} onAcknowledge={(id) => acknowledge.mutate(id)} />
            </div>
          ))}
          <TextLinksContext.Provider value={TEXT_LINKS}>
            <Outlet />
          </TextLinksContext.Provider>
        </main>
      </div>
    </PlatformProvider>
  );
}
