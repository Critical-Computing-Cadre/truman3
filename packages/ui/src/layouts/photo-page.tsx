import { LinkIcon } from "../icons.tsx";
import { ForumPostFrame, ForumSpaceFrame } from "./forum-page.tsx";
import type { FeedFrameProps, PageHeaderProps } from "./page-props.ts";

export { ForumPostFrame as PhotoPostFrame, ForumSpaceFrame as PhotoSpaceFrame };

/**
 * A rail of icons down the left on a wide screen, with words beside them where there's room. On a
 * phone, a top bar with the name, and the same icons along the bottom.
 */
export function PhotoHeader({ renderBrand, home, links, action }: PageHeaderProps) {
  const tabs = [home, ...links];
  return (
    <>
      <nav
        aria-label="Sections"
        className="fixed inset-y-0 left-0 z-20 hidden w-20 flex-col gap-1 border-r border-stone-200 bg-white px-3 py-6 md:flex xl:w-60"
      >
        {renderBrand("mb-6 flex min-w-0 items-center gap-2 px-3 text-xl font-bold")}
        {tabs.map(({ key, label, render }) => (
          <span key={key} className="contents">
            {render("flex items-center gap-4 rounded-lg px-3 py-3 font-medium hover:bg-stone-100")}
            <span className="sr-only">{label}</span>
          </span>
        ))}
        {action && <span className="mt-auto px-3">{action}</span>}
      </nav>
      <header className="sticky top-0 z-20 flex h-12 items-center border-b border-stone-200 bg-white px-4 md:hidden">
        {renderBrand("mr-auto flex min-w-0 items-center gap-2 text-lg font-bold")}
        {action}
      </header>
      <nav
        aria-label="Sections on a phone"
        className="fixed inset-x-0 bottom-0 z-20 flex border-t border-stone-200 bg-white md:hidden"
      >
        {tabs.map(({ key, label, render }) => (
          // Icons only on a phone, as on these platforms. The word is still there for a screen reader.
          <span key={key} className="flex flex-1 justify-center" title={label}>
            {render("block h-12 w-12 overflow-hidden text-[0px]")}
          </span>
        ))}
      </nav>
    </>
  );
}

function RailFeedFrame({
  renderProfile,
  side,
  top,
  children,
  width,
}: FeedFrameProps & { width: string }) {
  return (
    <div className="md:pl-20 xl:pl-60">
      <div className="mx-auto flex max-w-[64rem] justify-center gap-10">
        <div className={`w-full ${width} min-w-0 space-y-3`}>
          {top}
          {children}
        </div>
        <aside
          aria-label="About you"
          className="sticky top-6 hidden w-80 shrink-0 space-y-4 self-start lg:block"
        >
          {renderProfile(true)}
          {side}
        </aside>
      </div>
    </div>
  );
}

export { LinkIcon };

/** Stories across the top, then posts, with the viewer and suggestions to the right where there's room. */
export function PhotoFeedFrame(props: FeedFrameProps) {
  return <RailFeedFrame {...props} width="max-w-[29.5rem]" />;
}

/** The same, with a wider column, for short posts. */
export function ShortFeedFrame(props: FeedFrameProps) {
  return <RailFeedFrame {...props} width="max-w-[37.5rem]" />;
}
