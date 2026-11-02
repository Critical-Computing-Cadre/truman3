export function Avatar({
  name,
  url,
  size = "h-10 w-10",
}: {
  name: string;
  url: string | null;
  size?: string;
}) {
  if (url) {
    return <img src={url} alt="" loading="lazy" className={`${size} rounded-full object-cover`} />;
  }
  return (
    <span
      aria-hidden="true"
      className={`${size} flex items-center justify-center rounded-full bg-stone-300 font-medium text-stone-700`}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
