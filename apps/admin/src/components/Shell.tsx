import { useQuery } from "@tanstack/react-query";
import { Link, useMatches } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { type DraftInfo, get, type Researcher } from "../api.ts";
import { Logo } from "./Logo.tsx";

/**
 * The frame every signed-in page sits in: a bar across the top that says where you are and who you
 * are, and a menu down the left. The menu is the lab's pages, until you open a study to edit, when
 * it becomes that study's pages. On a phone the menu is a row that scrolls sideways.
 */

const ICONS = {
  studies: "M4 5h16v4H4zM4 11h16v4H4zM4 17h10v2H4z",
  lab: "M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.800 3h10.400a2 2 0 0 0 1.800-3l-5-9V3M7.500 15h9",
  agents:
    "M12 3v3M7 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM9.500 11v2M14.500 11v2M2 12h3M19 12h3",
  labs: "M3 21V8l6-4v17M9 21V10h8l4 3v8M2 21h20M13 14h2M13 17h2",
  back: "M15 5l-7 7 7 7",
  feed: "M4 4h16v6H4zM4 14h16v6H4z",
  cast: "M9 11a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7zM2.500 20a6.500 6.500 0 0 1 13 0M16 4.500a3.500 3.500 0 0 1 0 6.500M18 14.500a6.500 6.500 0 0 1 3.500 5.500",
  stories: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  spaces: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  moderation: "M12 3l8 3v6c0 4.500-3.200 8-8 9-4.800-1-8-4.500-8-9V6zM9 12l2 2 4-4",
  beats: "M3 12h4l2-6 4 12 2-6h6",
  tests: "M5 12l4 4L19 6M5 20h14",
  personas: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  agent:
    "M12 3l1.800 4.700L18.500 9.500l-4.700 1.800L12 16l-1.800-4.700L5.500 9.500l4.700-1.800zM18 15l.900 2.100L21 18l-2.100.900L18 21l-.900-2.100L15 18l2.100-.900z",
  settings:
    "M4 7h10M18 7h2M4 17h2M10 17h10M14 7a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM6 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0z",
} as const;

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[1.125rem] w-[1.125rem] shrink-0"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

const ITEM = "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap";
const item = (here: boolean) =>
  here
    ? `${ITEM} bg-primary-soft font-semibold text-primary`
    : `${ITEM} text-stone-700 hover:bg-stone-100`;

function Group({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <li className="contents md:block">
      {label && (
        <p className="hidden px-2.5 pt-4 pb-1 text-xs font-semibold tracking-wide text-stone-500 uppercase md:block">
          {label}
        </p>
      )}
      <ul className="contents md:block md:space-y-0.5">{children}</ul>
    </li>
  );
}

/** Whether any condition of a study uses a feature that the Moderation page sets up. */
export function usesModeration(conditions: DraftInfo["conditions"]) {
  return conditions.some(
    ({ features }) =>
      features.removal ||
      features.warnings ||
      features.flagAnswers ||
      features.reportAnswers ||
      features.bans ||
      features.autoRules ||
      features.appeals ||
      features.labels ||
      features.contextNotes,
  );
}

/** The pages of one study being edited. The same request the builder makes, so it's shared. */
function StudyMenu({ draftId, here }: { draftId: string; here: string }) {
  const info = useQuery({
    queryKey: ["draft", draftId, "info"],
    queryFn: () => get<DraftInfo>(`/admin/drafts/${draftId}`),
  });
  const conditions = info.data?.conditions ?? [];
  const page = (
    path:
      | ""
      | "/cast"
      | "/stories"
      | "/spaces"
      | "/moderation"
      | "/beats"
      | "/scenarios"
      | "/personas"
      | "/agent"
      | "/settings",
    label: string,
    icon: keyof typeof ICONS,
  ) => (
    <li>
      <Link
        to={`/drafts/$draftId${path}`}
        params={{ draftId }}
        activeOptions={{ exact: true }}
        className={item(here === `/drafts/$draftId${path}`)}
      >
        <Icon name={icon} />
        {label}
      </Link>
    </li>
  );
  return (
    <>
      <Group>
        <li>
          <Link
            to="/"
            activeOptions={{ exact: true }}
            className={`${ITEM} text-stone-500 hover:bg-stone-100`}
          >
            <Icon name="back" />
            Studies
          </Link>
        </li>
      </Group>
      <li className="hidden border-b border-stone-200 px-2.5 pt-2 pb-3 md:block">
        <p className="text-sm font-semibold break-words">{info.data?.title ?? " "}</p>
        {info.data && (
          <span className={`badge mt-1 ${info.data.closed ? "" : "badge-wait"}`}>
            {info.data.closed ? "Saved as a version" : "Draft"}
          </span>
        )}
      </li>
      <Group label="What's in it">
        {page("", "Feed", "feed")}
        {page("/cast", "Cast", "cast")}
        {conditions.some(({ features }) => features.stories) &&
          page("/stories", "Stories", "stories")}
        {conditions.some(({ features }) => features.spaces) && page("/spaces", "Spaces", "spaces")}
      </Group>
      <Group label="What happens">
        {page("/beats", "Beats", "beats")}
        {usesModeration(conditions) && page("/moderation", "Moderation", "moderation")}
      </Group>
      <Group label="Checking it">
        {page("/scenarios", "Tests", "tests")}
        {page("/personas", "Personas", "personas")}
      </Group>
      <Group label="Setting it up">
        {page("/settings", "Settings", "settings")}
        {page("/agent", "Agent", "agent")}
      </Group>
    </>
  );
}

function LabMenu({ me, here }: { me: Researcher; here: string }) {
  const elsewhere = ["/lab", "/operator", "/tokens"];
  return (
    <Group>
      <li>
        <Link to="/" activeOptions={{ exact: true }} className={item(!elsewhere.includes(here))}>
          <Icon name="studies" />
          Studies
        </Link>
      </li>
      <li>
        <Link to="/lab" className={item(here === "/lab")}>
          <Icon name="lab" />
          Your lab
        </Link>
      </li>
      <li>
        <Link to="/tokens" className={item(here === "/tokens")}>
          <Icon name="agents" />
          Access for agents
        </Link>
      </li>
      {me.operator && (
        <li>
          <Link to="/operator" className={item(here === "/operator")}>
            <Icon name="labs" />
            Labs
          </Link>
        </li>
      )}
    </Group>
  );
}

export function Frame({
  me,
  onSignOut,
  notice,
  children,
}: {
  me: Researcher;
  onSignOut: () => void;
  notice: ReactNode;
  children: ReactNode;
}) {
  const matches = useMatches();
  const last = matches.at(-1);
  const here = (last?.routeId ?? "/") as string;
  const draftId = (last?.params as { draftId?: string } | undefined)?.draftId;
  const labs = me.teams.map(({ name }) => name).join(", ");
  const initial = me.name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="min-h-dvh">
      <header className="flex h-12 items-center gap-3 border-b border-stone-200 bg-white px-4 text-sm">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <Logo />
          Truman 3
        </Link>
        {labs && (
          <span className="hidden truncate border-l border-stone-200 pl-3 text-stone-600 sm:inline">
            {labs}
          </span>
        )}
        <span className="ml-auto hidden items-center gap-2 sm:flex">
          <span
            aria-hidden="true"
            className="flex h-6 w-6 items-center justify-center rounded-full bg-stone-200 text-xs font-semibold text-stone-700"
          >
            {initial}
          </span>
          {me.name}
        </span>
        <button
          type="button"
          className="ml-auto rounded-md px-2 py-1 text-stone-600 hover:bg-stone-100 sm:ml-0"
          onClick={onSignOut}
        >
          Sign out
        </button>
      </header>
      {notice}
      <div className="md:flex md:min-h-[calc(100dvh-3rem)]">
        <nav
          aria-label={draftId ? "This study" : "Your lab"}
          className="shrink-0 overflow-x-auto border-b border-stone-200 bg-white md:w-56 md:overflow-x-visible md:border-r md:border-b-0"
        >
          <ul className="flex gap-1 p-2 md:sticky md:top-0 md:block md:max-h-dvh md:space-y-0.5 md:overflow-y-auto md:p-3">
            {draftId ? (
              <StudyMenu draftId={draftId} here={here} />
            ) : (
              <LabMenu me={me} here={here} />
            )}
          </ul>
        </nav>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
