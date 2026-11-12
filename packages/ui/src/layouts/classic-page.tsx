import { Decor, MessagesDock, SearchBox, SmallPrint, useChrome, useDecor } from "../chrome.tsx";
import { SearchIcon } from "../icons.tsx";
import type {
  FeedFrameProps,
  PageHeaderProps,
  PostFrameProps,
  SpaceFrameProps,
} from "./page-props.ts";

/** Sections a community feed has that a study doesn't, for show, each with a bright icon. */
const FOR_SHOW = [
  {
    word: "Friends",
    color: "#1f8fff",
    d: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20a7 7 0 0 1 14 0zm15.5 0a8.5 8.5 0 0 0-1.8-5.200A5.5 5.5 0 0 1 22 20z",
  },
  {
    word: "Groups",
    color: "#2f7df6",
    d: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zm-5.5 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm11 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM12 13.5c2.5 0 4.5 1.6 4.5 4v1h-9v-1c0-2.4 2-4 4.5-4z",
  },
  { word: "Saved", color: "#a033d1", d: "M6 2h12a1 1 0 0 1 1 1v19l-7-5-7 5V3a1 1 0 0 1 1-1z" },
  {
    word: "Memories",
    color: "#1aa3e8",
    d: "M12 2a10 10 0 1 0 10 10h-2.5A7.5 7.5 0 1 1 12 4.5zm1 4h-2.200v6.800l5 3 1.1-1.9-3.9-2.300z",
  },
  {
    word: "Events",
    color: "#f0445c",
    d: "M7 2v2H4a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1h-3V2h-2.5v2h-5V2zm5 8 1.5 3.1 3.5.5-2.5 2.4.6 3.4-3.1-1.6-3.1 1.6.6-3.400L7 13.600l3.5-.5z",
  },
  {
    word: "Marketplace",
    color: "#18b3a4",
    d: "M4 3h16l2 6a3.3 3.3 0 0 1-2 3v9H4v-9a3.3 3.3 0 0 1-2-3zm3 11v5h5v-5z",
  },
] as const;

function ShowIcon({ color, d }: { color: string; d: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-8 w-8 shrink-0" fill={color}>
      <path d={d} />
    </svg>
  );
}

const ROUND =
  "flex h-10 w-10 items-center justify-center rounded-full bg-stone-200/70 hover:bg-stone-300/70";

/** Which sections sit in the middle of the bar as tabs. The rest are round buttons at the right. */
const TABS = ["spaces", "explore"];

export function ClassicHeader({ renderBrand, home, links, action }: PageHeaderProps) {
  const chrome = useChrome();
  const decor = useDecor();
  const tabs = [home, ...links.filter(({ key }) => TABS.includes(key))];
  const buttons = links.filter(({ key }) => !TABS.includes(key));
  const tab =
    "flex h-13 min-w-0 flex-1 items-center justify-center border-b-[3px] border-transparent text-stone-600 hover:bg-stone-100 has-[[aria-current=page]]:border-accent md:h-14 md:w-24 md:flex-none";
  return (
    <header className="sticky top-0 z-20 bg-white shadow-sm">
      <nav className="mx-auto flex h-14 max-w-[90rem] items-center gap-2 px-3">
        <div className="flex min-w-0 items-center gap-2 md:w-80">
          {renderBrand("flex min-w-0 items-center gap-2 font-semibold")}
          <SearchBox
            placeholder={`Search ${chrome?.siteName ?? ""}`}
            className="hidden min-w-0 flex-1 lg:block"
            inputClassName="rounded-full bg-stone-100"
          />
        </div>
        {/* Tabs in the middle where there's room. On a phone they're a row of their own, below. */}
        <div className="hidden flex-1 justify-center md:flex">
          {tabs.map(({ key, label, render }) => (
            <span key={key} className={tab} title={label}>
              {render("flex h-11 w-12 rounded-lg text-[0px]")}
            </span>
          ))}
          {decor &&
            (["Video", "Marketplace"] as const).map((word) => (
              <Decor key={word} label={word} className={`${tab} hidden lg:flex`}>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  className="h-6 w-6"
                >
                  {word === "Video" ? (
                    <path d="M3 6h18v12H3zM10 9.5v5l4.5-2.5z" />
                  ) : (
                    <path d="M4 4h16l1.5 5a3 3 0 0 1-1.5 2.600V20H4v-8.400A3 3 0 0 1 2.5 9zM9 20v-5h6v5" />
                  )}
                </svg>
              </Decor>
            ))}
        </div>
        <div className="ml-auto flex items-center justify-end gap-2 md:ml-0 md:w-80">
          {decor && (
            <Decor label="Menu" className={`${ROUND} hidden md:flex`}>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                {[4, 12, 20].flatMap((y) =>
                  [4, 12, 20].map((x) => <circle key={`${x},${y}`} cx={x} cy={y} r="2.3" />),
                )}
              </svg>
            </Decor>
          )}
          {buttons.map(({ key, label, render }) => (
            <span
              key={key}
              className={`${ROUND} ${key === "profile" ? "" : "hidden md:flex"}`}
              title={label}
            >
              {render("flex h-10 w-12 text-[0px]")}
            </span>
          ))}
          {action && <span className="ml-1 shrink-0">{action}</span>}
        </div>
      </nav>
      <div className="flex border-t border-stone-200 md:hidden">
        {[home, ...links.filter(({ key }) => key !== "profile")].map(({ key, label, render }) => (
          <span key={key} className={tab} title={label}>
            {render("flex h-11 w-12 rounded-lg text-[0px]")}
          </span>
        ))}
      </div>
    </header>
  );
}

export function ClassicFeedFrame({ renderProfile, side, top, children }: FeedFrameProps) {
  const chrome = useChrome();
  const decor = useDecor();
  const row =
    "flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-[0.95rem] font-medium hover:bg-stone-200/70";
  return (
    <div className="justify-center gap-6 md:grid md:grid-cols-[17rem_minmax(0,37rem)] xl:grid-cols-[17rem_minmax(0,37rem)_19rem]">
      {/* Too narrow on a phone, where the Profile link in the header does this job. */}
      <aside className="hidden md:block">
        <div className="sticky top-18 space-y-3">
          {renderProfile(true)}
          {decor && (
            <nav aria-label="More places" className="space-y-0.5">
              {FOR_SHOW.map(({ word, color, d }) => (
                <Decor key={word} className={row}>
                  <ShowIcon color={color} d={d} />
                  {word}
                </Decor>
              ))}
              <Decor className={row}>
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-stone-200">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </span>
                See more
              </Decor>
            </nav>
          )}
          <SmallPrint
            words={["Privacy", "Terms", "Advertising", "Ad Choices", "Cookies", "More"]}
            className="border-t border-stone-300 px-2 pt-3"
          />
        </div>
      </aside>
      <div className="min-w-0 space-y-3 sm:space-y-4">
        {top}
        {children}
      </div>
      {/* Suggestions and the like, beside the feed where there's room, as on a community feed. */}
      <aside className="hidden space-y-4 xl:block">
        <div className="sticky top-18 space-y-4">
          {side}
          {decor && chrome?.viewer && (
            <section aria-label="Contacts" className="px-2 text-sm">
              <h2 className="flex items-center justify-between pb-2 font-semibold text-stone-600">
                Contacts
                <Decor label="Search contacts" className="text-stone-500">
                  <SearchIcon className="h-4 w-4" />
                </Decor>
              </h2>
              <p className="text-stone-500">Nobody's online right now.</p>
            </section>
          )}
        </div>
      </aside>
      <MessagesDock
        label="Messaging"
        className="flex w-72 items-center gap-2 rounded-t-xl border border-b-0 border-stone-300 bg-white px-3 py-2 text-sm shadow-lg"
      />
    </div>
  );
}

export function ClassicSpaceFrame({
  label,
  bannerUrl,
  accent,
  picture,
  name,
  description,
  members,
  join,
  rules,
  children,
}: SpaceFrameProps) {
  return (
    <div className="mx-auto max-w-xl space-y-3 sm:space-y-4">
      <section aria-label={label} className="overflow-hidden bg-white shadow-sm sm:rounded-lg">
        {/* Nothing is written over these, so a banner or color can't make the name hard to read. */}
        {bannerUrl ? (
          <img src={bannerUrl} alt="" className="h-24 w-full object-cover sm:h-32" />
        ) : (
          accent && (
            <div
              data-testid="space-color"
              className="h-12 w-full"
              style={{ backgroundColor: accent }}
            />
          )
        )}
        <div className="flex items-start gap-3 p-3">
          {picture}
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold">{name}</h1>
            {description && <p className="text-sm break-words text-stone-600">{description}</p>}
            {members}
          </div>
          {join}
        </div>
        {rules && (
          <div className="mx-3 mb-3 border-t border-stone-200 pt-2 text-sm">
            <h2 className="font-medium">Rules</h2>
            <p className="break-words whitespace-pre-wrap text-stone-700">{rules}</p>
          </div>
        )}
      </section>
      {children}
    </div>
  );
}

export function ClassicPostFrame({ children }: PostFrameProps) {
  return <div className="mx-auto max-w-2xl space-y-3 sm:space-y-4">{children}</div>;
}
