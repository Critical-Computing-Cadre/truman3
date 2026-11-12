import { addedDecorKey, DECOR_ITEMS, type DecorTarget } from "@truman3/core";
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
import { useFeature, usePlatform } from "./platform.tsx";

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
  /**
   * The real pages this study has that something for show can open instead of saying it isn't
   * available. One that's missing here stays for show.
   */
  go: Partial<Record<DecorTarget, (className: string, children: ReactNode) => ReactNode>>;
  /** Someone pressed something that's only for show, to be recorded. */
  onDecor?: ((key: string, label: string) => void) | undefined;
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

/** Whether one thing that's for show is drawn: the feature is on, and the study hasn't hidden it. */
export function useDecorShown(id: string) {
  const decor = useDecor();
  const hidden = usePlatform().decor?.hide.includes(id) ?? false;
  return decor && !hidden;
}

/** What pressing something for show does: says it isn't available, and has it recorded. */
function usePress() {
  const say = useContext(NoticeContext);
  const chrome = useChrome();
  return (key: string, label: string) => {
    say(label);
    chrome?.onDecor?.(key, label);
  };
}

/**
 * Something a real site of this kind would have here, from the list in `DECOR_ITEMS`. Where the
 * study has a real page for it, it's a link to that page. Otherwise pressing it says it isn't
 * available right now, as a real site would of a part that's down, and the press is recorded. A
 * study can hide any of them. One that's only for show is marked `data-decor`, so tests can tell.
 */
export function Decor({
  id,
  children,
  className = "",
  iconOnly = false,
}: {
  /** Its key in this layout's list. */
  id: string;
  children: ReactNode;
  className?: string;
  /** Whether it's drawn as an icon alone, and so needs its name for a screen reader. */
  iconOnly?: boolean;
}) {
  const { layout } = usePlatform();
  const chrome = useChrome();
  const shown = useDecorShown(id);
  const press = usePress();
  if (!shown) {
    return null;
  }
  const item = DECOR_ITEMS[layout].find(({ key }) => key === id);
  const label = item?.label ?? id;
  const real = item?.opens ? chrome?.go[item.opens] : undefined;
  if (real) {
    return real(
      className,
      <>
        {children}
        {iconOnly && <span className="sr-only">{label}</span>}
      </>,
    );
  }
  return (
    <button
      type="button"
      data-decor={id}
      onClick={() => press(id, label)}
      className={`cursor-pointer text-left ${className}`}
      {...(iconOnly ? { "aria-label": label, title: label } : {})}
    >
      {children}
    </button>
  );
}

/**
 * What a study added of its own, for a layout's menu. Each does what the rest do: says it isn't
 * available, and is recorded. A layout says how to draw one, since a rail of icons has no room for
 * words.
 */
export function AddedDecor({
  className = "",
  render,
}: {
  className?: string;
  render: (label: string) => ReactNode;
}) {
  const added = usePlatform().decor?.add ?? [];
  const decor = useDecor();
  const press = usePress();
  if (!decor) {
    return null;
  }
  return added.map((label) => (
    <button
      key={label}
      type="button"
      data-decor={addedDecorKey(label)}
      title={label}
      onClick={() => press(addedDecorKey(label), label)}
      className={`cursor-pointer text-left ${className}`}
    >
      {render(label)}
    </button>
  ));
}

/** A plain mark for something a study added, which has no icon of its own: its first letter. */
export function AddedMark({ label, className = "h-8 w-8" }: { label: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent ${className}`}
    >
      {label.charAt(0).toUpperCase()}
    </span>
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
  const shown = useDecorShown("search");
  const press = usePress();
  // A study that hides it for show still has it where it really looks something up.
  if (!chrome || (!shown && !chrome.onSearch)) {
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
      press("search", "Search");
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
 * The small print a real site has at the bottom of a column, from this layout's list: words that
 * are for show, links to the study's own pages where it has them, and a line with the year.
 */
export function SmallPrint({ className = "", owner }: { className?: string; owner?: string }) {
  const chrome = useChrome();
  const decor = useDecor();
  const { layout } = usePlatform();
  if (!chrome) {
    return null;
  }
  const words = DECOR_ITEMS[layout].filter(({ where }) => where === "Small print");
  // With what's for show turned off, the study's own pages are still worth a link.
  const shown = decor ? words : words.filter(({ opens }) => opens && chrome.go[opens]);
  if (shown.length === 0) {
    return null;
  }
  return (
    <footer className={`text-xs leading-relaxed text-stone-500 ${className}`}>
      <p className="flex flex-wrap gap-x-2">
        {shown.map(({ key, label, opens }) =>
          decor ? (
            <Decor key={key} id={key} className="hover:underline">
              {label}
            </Decor>
          ) : (
            <span key={key}>{opens && chrome.go[opens]?.("hover:underline", label)}</span>
          ),
        )}
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
  const shown = useDecorShown("corner");
  const press = usePress();
  if (!chrome?.viewer || !shown) {
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
        <button
          type="button"
          data-decor="corner"
          onClick={() => press("corner", label)}
          className={`cursor-pointer text-left ${className}`}
        >
          {inside}
        </button>
      )}
    </div>
  );
}
