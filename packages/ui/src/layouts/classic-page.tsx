import { Fragment } from "react";
import type {
  FeedFrameProps,
  PageHeaderProps,
  PostFrameProps,
  SpaceFrameProps,
} from "./page-props.ts";

export function ClassicHeader({ renderBrand, links, action }: PageHeaderProps) {
  return (
    <header className="sticky top-0 z-20 bg-white shadow-sm">
      <nav className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-3">
        {renderBrand("mr-auto flex min-w-0 items-center gap-2 font-semibold")}
        {links.map(({ key, label, render }) => (
          <Fragment key={key}>
            {/* An icon alone on a phone, where the words wouldn't fit beside the name. */}
            <span className="contents" title={label}>
              {render(
                "flex h-11 items-center rounded-lg pr-0 text-[0px] font-medium hover:bg-stone-100 md:pr-3 md:text-sm",
              )}
            </span>
          </Fragment>
        ))}
        {action && <span className="ml-2 shrink-0">{action}</span>}
      </nav>
    </header>
  );
}

export function ClassicFeedFrame({ renderProfile, side, top, children }: FeedFrameProps) {
  return (
    <div className="justify-center gap-6 md:grid md:grid-cols-[15rem_minmax(0,36rem)] lg:grid-cols-[15rem_minmax(0,36rem)_18rem]">
      {/* Too narrow on a phone, where the Profile link in the header does this job. */}
      <aside className="hidden md:block">
        <div className="sticky top-16">{renderProfile(false)}</div>
      </aside>
      <div className="min-w-0 space-y-3 sm:space-y-4">
        {top}
        {children}
      </div>
      {/* Suggestions and the like, beside the feed where there's room, as on a community feed. */}
      {side && (
        <aside className="hidden space-y-4 lg:block">
          <div className="sticky top-16 space-y-4">{side}</div>
        </aside>
      )}
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
