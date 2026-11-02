import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { get, type StudySummary } from "../api.ts";

export function StudiesPage() {
  const list = useQuery({
    queryKey: ["studies"],
    queryFn: () => get<{ studies: StudySummary[] }>("/admin/studies"),
  });

  return (
    <main className="mx-auto max-w-3xl p-4">
      <h1 className="mb-4 text-2xl font-semibold">Studies</h1>
      {list.data?.studies.length === 0 && (
        <p className="text-stone-600">
          No studies yet. Import one with <code>pnpm study import</code>.
        </p>
      )}
      <ul className="space-y-3">
        {list.data?.studies.map((study) => {
          const [latest, ...older] = study.versions;
          return (
            <li key={study.id} className="rounded-lg bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold">{latest?.title ?? study.slug}</h2>
              <p className="text-sm text-stone-600">
                {study.team} · {study.participants} participants
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {[latest, ...older].map(
                  (version) =>
                    version && (
                      <Link
                        key={version.id}
                        to="/preview/$versionId"
                        params={{ versionId: version.id }}
                        className="rounded border border-stone-300 px-3 py-1.5 text-sm"
                      >
                        See the feed: version {version.version}
                      </Link>
                    ),
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
