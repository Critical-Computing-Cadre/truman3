import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { type FeedWarning, textOnAccent } from "@truman3/core";
import {
  BrandName,
  type Chrome,
  ChromeProvider,
  LinkIcon,
  PageBody,
  PageHeader,
  type PageLink,
  PlatformProvider,
  type TextLinks,
  TextLinksContext,
  WarningNotice,
} from "@truman3/ui";
import { useEffect } from "react";
import { type FlowState, get, meQuery, post } from "../api.ts";
import { useLive } from "../live.ts";
import { flushTracking, track } from "../tracking.ts";

const POLL_EVERY_MS = 30_000;

/** Layouts whose sections show an icon before each word. A forum draws its own (ForumHeader). */
const ICON_LAYOUTS: string[] = ["photo", "short-posts", "classic"];

/**
 * On a platform that shows icons for its sections, an icon goes before each link's word. The link
 * stretches over the icon too, so either one can be pressed.
 */
function withIcon(link: PageLink): PageLink {
  return {
    ...link,
    render: (className) => (
      <span className="relative flex items-center has-[[aria-current=page]]:font-bold has-[[aria-current=page]]:text-accent">
        <LinkIcon name={link.key} className="pointer-events-none absolute left-3 h-6 w-6" />
        {link.render(`${className} pl-12 after:absolute after:inset-0`)}
      </span>
    ),
  };
}

const LINK = "font-medium text-accent underline-offset-2 hover:underline";
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

/**
 * Puts the platform's colors on the whole page, so the page behind posts takes them too, and so
 * does a window that opens above everything.
 */
export function useSkin(
  layout: FlowState["layout"] | undefined,
  accent: FlowState["accent"] | undefined,
) {
  useEffect(() => {
    const root = document.documentElement;
    if (!layout) {
      return;
    }
    root.dataset.layout = layout;
    if (accent) {
      root.style.setProperty("--accent-base", accent);
      root.style.setProperty("--color-on-accent", textOnAccent(accent));
    }
    return () => {
      delete root.dataset.layout;
      root.style.removeProperty("--accent-base");
      root.style.removeProperty("--color-on-accent");
    };
  }, [layout, accent]);
}

/** The header and page around everything once someone's in the feed. */
export function Shell({ flow, onAdvanced }: { flow: FlowState; onAdvanced: () => void }) {
  const me = useQuery({ ...meQuery, refetchInterval: POLL_EVERY_MS });
  const unread = me.data?.unreadNotifications ?? 0;
  const unreadMessages = me.data?.unreadMessages ?? 0;
  useTheme(flow.theme);
  useLive(flow.shared);
  const client = useQueryClient();
  const navigate = useNavigate();
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
    ...(flow.features.messages
      ? [
          {
            key: "messages",
            label: "Messages",
            render: (className: string) => (
              <Link
                to="/messages"
                className={`relative ${className}`}
                aria-label={`Messages, ${unreadMessages} new`}
              >
                Messages
                {unreadMessages > 0 && (
                  <span className="absolute top-0 right-0 rounded-full bg-rose-600 px-1 text-[0.65rem] leading-4 text-white">
                    {unreadMessages}
                  </span>
                )}
              </Link>
            ),
          },
        ]
      : []),
    ...(flow.site.hasRules
      ? [
          {
            key: "rules",
            label: "Rules",
            render: (className: string) => (
              <Link to="/rules" search={{ from: "menu" }} className={className}>
                Rules
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

  const chrome: Chrome = {
    siteName: flow.site.name,
    viewer: me.data
      ? {
          name: me.data.name,
          username: me.data.username,
          pictureUrl: me.data.pictureUrl,
          render: (className, children) => (
            <Link to="/u/$username" params={{ username: me.data.username }} className={className}>
              {children}
            </Link>
          ),
        }
      : null,
    // A search goes to that word's hashtag page, the one place there is to look something up.
    onSearch: flow.features.hashtags
      ? (words) => {
          const tag = words.split(/\s+/)[0]?.replace(/^#/, "").toLowerCase();
          if (tag) {
            navigate({ to: "/tags/$tag", params: { tag } });
          }
        }
      : undefined,
    messages: flow.features.messages
      ? {
          unread: unreadMessages,
          render: (className, children) => (
            <Link to="/messages" className={className}>
              {children}
            </Link>
          ),
        }
      : undefined,
    go: {
      ...(flow.features.spaces
        ? {
            spaces: (className, children) => (
              <Link to="/spaces" className={className}>
                {children}
              </Link>
            ),
          }
        : {}),
      ...(flow.features.trending || flow.features.whoToFollow || flow.features.exploreGrid
        ? {
            explore: (className, children) => (
              <Link to="/explore" className={className}>
                {children}
              </Link>
            ),
          }
        : {}),
      ...(flow.features.saving && me.data
        ? {
            saved: (className, children) => (
              <Link to="/u/$username" params={{ username: me.data.username }} className={className}>
                {children}
              </Link>
            ),
          }
        : {}),
      ...(me.data
        ? {
            account: (className, children) => (
              <Link to="/account" className={className}>
                {children}
              </Link>
            ),
          }
        : {}),
      ...(flow.site.hasRules
        ? {
            rules: (className, children) => (
              <Link to="/rules" search={{ from: "menu" }} className={className}>
                {children}
              </Link>
            ),
          }
        : {}),
      ...(flow.site.hasTerms
        ? {
            terms: (className, children) => (
              <Link to="/terms" className={className}>
                {children}
              </Link>
            ),
          }
        : {}),
      ...(flow.site.hasPrivacy
        ? {
            privacy: (className, children) => (
              <Link to="/privacy" className={className}>
                {children}
              </Link>
            ),
          }
        : {}),
    },
    onDecor: (key, label) =>
      track({ type: "decor.pressed", payload: { key, label, page: window.location.pathname } }),
  };

  return (
    <PlatformProvider platform={flow}>
      <ChromeProvider value={chrome}>
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
                  <BrandName name={flow.site.name} />
                )}
              </Link>
            )}
            home={(ICON_LAYOUTS.includes(flow.layout) ? withIcon : (link: PageLink) => link)({
              key: "home",
              label: "Home",
              render: (className) => (
                // Only on the feed itself, or it would be marked as where they are on every page.
                <Link to="/" activeOptions={{ exact: true }} className={className}>
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
                  className="rounded bg-accent-fill px-3 py-1.5 text-sm text-on-accent"
                >
                  Finish
                </button>
              ) : undefined
            }
          />
          <PageBody>
            <main className="mx-auto max-w-[84rem] pb-16 sm:px-3 sm:pt-4">
              {(warnings.data?.warnings ?? []).map((warning) => (
                <div key={warning.id} className="mb-3">
                  <WarningNotice warning={warning} onAcknowledge={(id) => acknowledge.mutate(id)} />
                </div>
              ))}
              <TextLinksContext.Provider value={TEXT_LINKS}>
                <Outlet />
              </TextLinksContext.Provider>
              {(flow.site.hasTerms || flow.site.hasPrivacy) && (
                // Small print at the bottom, as real sites have.
                <footer className="mt-8 flex justify-center gap-4 text-xs text-stone-500">
                  {flow.site.hasTerms && (
                    <Link to="/terms" className="hover:underline">
                      Terms of service
                    </Link>
                  )}
                  {flow.site.hasPrivacy && (
                    <Link to="/privacy" className="hover:underline">
                      Privacy policy
                    </Link>
                  )}
                </footer>
              )}
            </main>
          </PageBody>
        </div>
      </ChromeProvider>
    </PlatformProvider>
  );
}
