/**
 * The top of a page that's one step in from somewhere else, like Settings: an arrow back, and the
 * page's name, as apps have. The arrow goes wherever they came from.
 */
export function BackBar({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 bg-white px-2 py-2 sm:mb-3 sm:rounded-lg sm:shadow-sm">
      <button
        type="button"
        aria-label="Back"
        onClick={() => window.history.back()}
        className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-stone-100"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-6 w-6"
        >
          <path d="M19 12H5M11 6l-6 6 6 6" />
        </svg>
      </button>
      <h1 className="text-xl font-semibold">{title}</h1>
    </div>
  );
}
