import { Fragment } from "react";
import type {
  FeedFrameProps,
  PageHeaderProps,
  PostFrameProps,
  SpaceFrameProps,
} from "./page-props.ts";

export function ClassicHeader({ renderBrand, links, action }: PageHeaderProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-stone-200 bg-white">
      {/* Wraps on a phone, or a study's name would be squeezed out by the links beside it. */}
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
        {renderBrand("mr-auto flex min-w-0 items-center gap-2 font-semibold")}
        {links.map(({ key, render }) => (
          <Fragment key={key}>{render("text-sm")}</Fragment>
        ))}
        {action}
      </nav>
    </header>
  );
}

export function ClassicFeedFrame({ renderProfile, top, children }: FeedFrameProps) {
  return (
    <div className="justify-center gap-4 md:grid md:grid-cols-[14rem_minmax(0,36rem)] lg:grid-cols-[14rem_minmax(0,36rem)_14rem]">
      {/* Too narrow on a phone, where the Profile link in the header does this job. */}
      <aside className="hidden md:block">
        <div className="sticky top-16">{renderProfile(false)}</div>
      </aside>
      <div className="min-w-0 space-y-3 sm:space-y-4">
        {top}
        {children}
      </div>
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
