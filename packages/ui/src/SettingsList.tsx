import { SETTINGS_DECOR } from "@truman3/core";
import type { ReactNode } from "react";
import { Avatar } from "./Avatar.tsx";
import { Decor, SmallPrint, useChrome, useDecor } from "./chrome.tsx";

/** One line on the settings page that opens a real page of this study's. */
export interface SettingsRow {
  /** Which icon it gets: "profile", "saved", "rules", "mod-log", "terms", or "privacy". */
  key: string;
  label: string;
  render: (className: string, children: ReactNode) => ReactNode;
}

const ICONS: Record<string, string> = {
  profile: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20a8 8 0 0 1 16 0",
  saved: "M6 3h12v18l-6-4-6 4z",
  rules: "M6 3h9l4 4v14H6zM9 12h7M9 16h7",
  "mod-log": "M12 3l8 3v6c0 5-3 8-8 9-5-1-8-4-8-9V6z",
  terms: "M6 3h12v18H6zM9 8h6M9 12h6M9 16h3",
  privacy: "M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3",
  "settings-security": "M12 3l8 3v6c0 5-3 8-8 9-5-1-8-4-8-9V6zM9 12l2 2 4-4",
  "settings-notifications": "M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0",
  "settings-appearance": "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 3v2M12 19v2M3 12h2M19 12h2",
  "settings-languages":
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  "settings-accessibility":
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 10h8M12 10v4l-2 4M12 14l2 4M12 7h.01",
  "settings-help":
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01",
};

function Icon({ name }: { name: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-6 w-6 shrink-0"
    >
      <path d={ICONS[name] ?? ICONS.rules} />
    </svg>
  );
}

function Line({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <>
      <Icon name={icon} />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5 shrink-0 text-stone-400"
      >
        <path d="m9 6 6 6-6 6" />
      </svg>
    </>
  );
}

const LINE = "flex w-full items-center gap-4 px-4 py-3.5 text-left text-base hover:bg-stone-50";

/**
 * A settings page as apps have one: who's signed in, then a list of lines, each with an icon and
 * an arrow. The lines a page hands over open this study's real pages. Below them are the ones a
 * real app would also have, which are only for show (`Decor`), where a study has that on.
 */
export function SettingsList({ rows }: { rows: SettingsRow[] }) {
  const viewer = useChrome()?.viewer;
  const decor = useDecor();
  return (
    <div className="bg-white sm:rounded-lg sm:shadow-sm">
      {viewer && (
        <div className="flex flex-col items-center gap-1 border-b border-stone-200 px-4 py-6">
          <Avatar seed={viewer.username} url={viewer.pictureUrl} size="h-20 w-20" />
          <p className="mt-1 text-xl font-bold">{viewer.name}</p>
          <p className="text-sm text-stone-500">@{viewer.username}</p>
        </div>
      )}
      <ul aria-label="Your settings">
        {rows.map(({ key, label, render }) => (
          <li key={key}>{render(LINE, <Line icon={key}>{label}</Line>)}</li>
        ))}
      </ul>
      {decor && (
        <ul aria-label="More settings" className="border-t border-stone-200">
          {SETTINGS_DECOR.map(({ key, label }) => (
            <li key={key} className="empty:hidden">
              <Decor id={key} className={LINE}>
                <Line icon={key}>{label}</Line>
              </Decor>
            </li>
          ))}
        </ul>
      )}
      <SmallPrint className="border-t border-stone-200 px-4 py-4" />
    </div>
  );
}
