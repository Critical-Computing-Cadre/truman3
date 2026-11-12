import { usePlatform } from "./platform.tsx";

/**
 * The site's name in the header, for a study with no logo of its own. Each kind of site writes it its
 * own way, so two studies don't look like one site with the name changed.
 */
export function BrandName({ name }: { name: string }) {
  const { layout } = usePlatform();
  const letter = name.trim().charAt(0).toUpperCase();
  switch (layout) {
    case "classic":
      return (
        <>
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-fill text-lg font-bold text-on-accent"
          >
            {letter}
          </span>
          <span className="truncate text-lg font-bold tracking-tight text-accent">{name}</span>
        </>
      );
    case "forum":
      return (
        <>
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-fill text-base font-extrabold text-on-accent"
          >
            {letter.toLowerCase()}
          </span>
          <span className="truncate font-extrabold tracking-tight lowercase">{name}</span>
        </>
      );
    case "photo":
      return (
        <span className="truncate bg-gradient-to-r from-amber-500 via-rose-500 to-fuchsia-600 bg-clip-text pr-1 font-serif text-2xl font-bold tracking-tight text-transparent italic">
          {name}
        </span>
      );
    default:
      return <span className="truncate font-extrabold tracking-tight text-accent">{name}</span>;
  }
}
