import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { SettingsList, type SettingsRow } from "@truman3/ui";
import type { ReactNode } from "react";
import { flowQuery, meQuery } from "../api.ts";
import { BackBar } from "../components/BackBar.tsx";

/**
 * A settings page, as apps have one (ADR 105). Each line at the top opens a real page this study
 * has: editing a profile, saved posts, the rules, the terms. Under them, where the study shows
 * things for show, are the lines a real app would also have.
 */
export function SettingsPage() {
  const flow = useQuery(flowQuery);
  const me = useQuery(meQuery);
  if (!flow.data || !me.data) {
    return null;
  }
  const { features, site } = flow.data;
  const { username } = me.data;
  const rows: SettingsRow[] = [
    {
      key: "profile",
      label: "Edit profile",
      render: (className, children) => (
        <Link to="/account" className={className}>
          {children}
        </Link>
      ),
    },
    ...(features.saving
      ? [
          {
            key: "saved",
            label: "Saved posts",
            render: (className: string, children: ReactNode) => (
              <Link to="/u/$username" params={{ username }} className={className}>
                {children}
              </Link>
            ),
          },
        ]
      : []),
    ...(site.hasRules
      ? [
          {
            key: "rules",
            label: "Community rules",
            render: (className: string, children: ReactNode) => (
              <Link to="/rules" search={{ from: "menu" }} className={className}>
                {children}
              </Link>
            ),
          },
        ]
      : []),
    ...(features.modLog && !features.spaces
      ? [
          {
            key: "mod-log",
            label: "Mod log",
            render: (className: string, children: ReactNode) => (
              <Link to="/mod-log" className={className}>
                {children}
              </Link>
            ),
          },
        ]
      : []),
    ...(site.hasTerms
      ? [
          {
            key: "terms",
            label: "Terms of service",
            render: (className: string, children: ReactNode) => (
              <Link to="/terms" className={className}>
                {children}
              </Link>
            ),
          },
        ]
      : []),
    ...(site.hasPrivacy
      ? [
          {
            key: "privacy",
            label: "Privacy policy",
            render: (className: string, children: ReactNode) => (
              <Link to="/privacy" className={className}>
                {children}
              </Link>
            ),
          },
        ]
      : []),
  ];
  return (
    <div className="mx-auto max-w-xl">
      <BackBar title="Settings" />
      <SettingsList rows={rows} />
    </div>
  );
}
