import {
  createContext,
  type FormEvent,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { Avatar } from "./Avatar.tsx";
import { SearchIcon } from "./icons.tsx";
import { useFeature } from "./platform.tsx";

/**
 * What a layout needs to draw the page around posts the way a real site would: who's looking, what
 * the site is called, and where its real pages are. The participant app fills this in. Without it,
 * as in the builder's preview, a layout draws only the posts.
 */
export interface Chrome {
  siteName: string;
  viewer: {
    name: string;
    username: string;
    pictureUrl: string | null;
    /** A link to their own page. */
    render: (className: string, children: ReactNode) => ReactNode;
  } | null;
  /** Looks something up, where the platform has somewhere to look. Without it, the box is for show. */
  onSearch?: ((words: string) => void) | undefined;
  /** Direct messages, on a platform that has them. */
  messages?:
    | { unread: number; render: (className: string, children: ReactNode) => ReactNode }
    | undefined;
  /** Real pages the study wrote, such as its terms, for the small print. */
  pages: { key: string; render: (className: string) => ReactNode }[];
}

const ChromeContext = createContext<Chrome | null>(null);
/** Says that something pressed isn't there, where the page has somewhere to say it. */
const NoticeContext = createContext<(name: string) => void>(() => {});

/** How long the note stays, which is long enough to read and short enough not to be in the way. */
const NOTICE_MS = 3500;

/**
 * Gives layouts what they need to draw the page, and says so when someone presses something that's
 * only for show, the way a real site says a part of it is down.
 */
export function ChromeProvider({ value, children }: { value: Chrome; children: ReactNode }) {
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (notice === null) {
      return;
    }
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  return (
    <ChromeContext.Provider value={value}>
      <NoticeContext.Provider value={setNotice}>
        {children}
        <p
          role="status"
          className={`fixed bottom-20 left-1/2 z-40 max-w-[90vw] -translate-x-1/2 rounded-lg bg-stone-900 px-4 py-2.5 text-sm text-white shadow-lg transition-opacity ${notice === null ? "pointer-events-none opacity-0" : "opacity-100"}`}
        >
          {notice !== null && `${notice} isn't available right now. Please try again later.`}
        </p>
      </NoticeContext.Provider>
    </ChromeContext.Provider>
  );
}

export function useChrome() {
  return useContext(ChromeContext);
}

/**
 * Whether to draw what's only for show: a longer menu, small print, a search box that looks nothing
 * up. It's a feature (`decor`), so a study can turn it off, and it needs the page around it.
 */
export function useDecor() {
  const on = useFeature("decor");
  return useChrome() !== null && on;
}

/**
 * Something a real site would have here that this one doesn't. Pressing it says it isn't available
 * right now, as a real site would of a part that's down, so nobody is left wondering whether their
 * press was noticed. It's marked so a study's records and tests can tell it from a real button.
 */
export function Decor({
  children,
  className = "",
  label,
}: {
  children: ReactNode;
  className?: string;
  /** What it's called, where it's only an icon. */
  label?: string;
}) {
  const say = useContext(NoticeContext);
  return (
    <button
      type="button"
      data-decor=""
      onClick={(event) => say(label ?? event.currentTarget.textContent?.trim() ?? "This")}
      className={`cursor-pointer text-left ${className}`}
      {...(label ? { "aria-label": label, title: label } : {})}
    >
      {children}
    </button>
  );
}

/** A search box. It looks something up where the platform can, and otherwise is for show. */
export function SearchBox({
  placeholder,
  className = "",
  inputClassName = "",
}: {
  placeholder: string;
  className?: string;
  inputClassName?: string;
}) {
  const chrome = useChrome();
  const [words, setWords] = useState("");
  const decor = useDecor();
  const say = useContext(NoticeContext);
  if (!chrome || (!decor && !chrome.onSearch)) {
    return null;
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!words.trim()) {
      return;
    }
    if (chrome.onSearch) {
      chrome.onSearch(words.trim());
    } else {
      say("Search");
    }
  };
  return (
    <form onSubmit={submit} className={`relative ${className}`}>
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-stone-500" />
      <input
        type="search"
        aria-label="Search"
        placeholder={placeholder}
        value={words}
        onChange={(event) => setWords(event.target.value)}
        className={`w-full min-w-0 py-2 pr-3 pl-9 text-sm outline-none placeholder:text-stone-500 ${inputClassName}`}
      />
    </form>
  );
}

/**
 * The small print a real site has at the bottom of a column: a few words that go nowhere, the
 * study's own pages where it has them, and a line with the year.
 */
export function SmallPrint({
  words,
  className = "",
  owner,
}: {
  /** Words for show, such as About and Help. */
  words: readonly string[];
  className?: string;
  /** Who the last line says it belongs to. The site's name, unless a layout writes it another way. */
  owner?: string;
}) {
  const chrome = useChrome();
  const decor = useDecor();
  if (!chrome || (!decor && chrome.pages.length === 0)) {
    return null;
  }
  return (
    <footer className={`text-xs leading-relaxed text-stone-500 ${className}`}>
      <p className="flex flex-wrap gap-x-2">
        {decor &&
          words.map((word) => (
            <Decor key={word} className="hover:underline">
              {word}
            </Decor>
          ))}
        {chrome.pages.map(({ key, render }) => (
          <span key={key}>{render("hover:underline")}</span>
        ))}
      </p>
      {decor && (
        <p className="mt-2">
          {owner ?? chrome.siteName} © {new Date().getFullYear()}
        </p>
      )}
    </footer>
  );
}

/**
 * A place for messages in the corner, as these sites have. It opens the Messages page where the
 * platform has direct messages, and is for show where it doesn't.
 */
export function MessagesDock({ label, className }: { label: string; className: string }) {
  const chrome = useChrome();
  const decor = useDecor();
  if (!chrome?.viewer || (!chrome.messages && !decor)) {
    return null;
  }
  const inside = (
    <>
      <Avatar seed={chrome.viewer.username} url={chrome.viewer.pictureUrl} size="h-7 w-7" />
      <span className="font-semibold">{label}</span>
      {chrome.messages && chrome.messages.unread > 0 && (
        <span className="rounded-full bg-like px-1.5 text-xs leading-5 text-white">
          {chrome.messages.unread}
        </span>
      )}
    </>
  );
  return (
    // Only where there's room. On a phone it would sit on top of the posts.
    <div className="fixed right-4 bottom-0 z-20 hidden lg:block">
      {chrome.messages ? (
        chrome.messages.render(className, inside)
      ) : (
        <Decor className={className}>{inside}</Decor>
      )}
    </div>
  );
}
