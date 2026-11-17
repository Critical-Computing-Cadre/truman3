import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useRef, useState } from "react";
import { download, get, post, send } from "../api.ts";

interface LibraryStudy {
  id: string;
  title: string;
  summary: string;
  paper: string;
  license: string;
  lab: string;
  status: "waiting" | "listed";
  publishedAt: string;
  about: {
    kind: string;
    days: number;
    conditions: string[];
    cast: number;
    posts: number;
    comments: number;
    pictures: string[];
  };
  mine: boolean;
}

interface Library {
  studies: LibraryStudy[];
  decides: boolean;
  licenses: string[];
}

const KINDS: Record<string, string> = {
  classic: "Classic",
  photo: "Photo",
  shortPosts: "Short posts",
  forum: "Forum",
};
const toLinkName = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

/** Copies a published study into one of the researcher's labs, under a name of its own. */
function CopyButton({
  study,
  teams,
}: {
  study: LibraryStudy;
  teams: { id: string; name: string }[];
}) {
  const navigate = useNavigate();
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(study.title);
  const [typedSlug, setTypedSlug] = useState<string | null>(null);
  // Their labs may arrive after this is drawn, so the first one is the choice until they pick.
  const [teamChoice, setTeamId] = useState<string | null>(null);
  const teamId = teamChoice ?? teams[0]?.id ?? "";
  const slug = typedSlug ?? toLinkName(title);
  const copy = useMutation({
    mutationFn: () =>
      post<{ draftId: string }>(`/admin/library/${study.id}/copy`, { teamId, title, slug }),
    onSuccess: ({ draftId }) => navigate({ to: "/drafts/$draftId", params: { draftId } }),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    copy.mutate();
  };
  return (
    <>
      <button
        type="button"
        disabled={teams.length === 0}
        onClick={() => dialog.current?.showModal()}
        className="btn btn-primary"
      >
        Copy into my lab
      </button>
      <dialog
        ref={dialog}
        aria-label={`Copy ${study.title}`}
        className="m-auto w-[min(90vw,30rem)] p-6 backdrop:bg-black/50"
      >
        <form onSubmit={submit} className="space-y-3">
          <h2 className="text-lg font-semibold">Copy this study into your lab</h2>
          <p className="text-sm text-stone-600">
            You get all of it as a draft of your own, to look through and change. Its consent page
            starts with placeholder text, since yours has to be the wording your own ethics board
            approved.
          </p>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Title
            <input
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="rounded border border-stone-300 px-2 py-1.5 font-normal"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Link name
            <input
              required
              pattern="[a-z0-9][a-z0-9_\-]*"
              title="Lowercase letters, numbers, dashes, and underscores"
              value={slug}
              onChange={(event) => setTypedSlug(event.target.value)}
              className="rounded border border-stone-300 px-2 py-1.5 font-normal"
            />
            <span className="text-xs font-normal text-stone-500">
              Participants join at /join/{slug || "…"}. This can't change later.
            </span>
          </label>
          {teams.length > 1 && (
            <label className="flex flex-col gap-1 text-sm font-medium">
              Team
              <select
                value={teamId}
                onChange={(event) => setTeamId(event.target.value)}
                className="rounded border border-stone-300 px-2 py-1.5 font-normal"
              >
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {copy.error && (
            <p role="alert" className="text-sm text-rose-700">
              {copy.error.message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => dialog.current?.close()} className="btn">
              Not now
            </button>
            <button
              type="submit"
              disabled={copy.isPending || !title.trim() || !slug}
              className="btn btn-primary"
            >
              {copy.isPending ? "Copying..." : "Copy it"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

/**
 * Studies that labs on this Truman have published for each other to copy (ADR 92). Each is a
 * replication bundle (ADR 91): the study as it ran, with no participants or data.
 */
export function LibraryPage() {
  const client = useQueryClient();
  const library = useQuery({
    queryKey: ["library"],
    queryFn: () => get<Library>("/admin/library"),
  });
  const teams = useQuery({
    queryKey: ["packs"],
    queryFn: () => get<{ teams: { id: string; name: string }[] }>("/admin/packs"),
  });
  const decide = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "listed" | "removed" }) =>
      send("PUT", `/admin/library/${id}/status`, { status }),
    onSettled: () => client.invalidateQueries({ queryKey: ["library"] }),
  });
  const bundle = useMutation({
    mutationFn: (id: string) => download(`/admin/library/${id}/bundle`, {}),
  });

  if (!library.data) {
    return null;
  }
  const { studies, decides } = library.data;
  return (
    <main className="page space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">
          Library <span className="text-lg font-normal text-stone-500">({studies.length})</span>
        </h1>
        <p className="text-stone-600">
          Studies other labs here have published, as they ran. Copy one into your lab to rerun it or
          build on it. To publish one of yours, press <strong>Publish</strong> beside a saved
          version on the Studies page.
        </p>
      </div>
      {studies.length === 0 && (
        <div className="card border-dashed p-8 text-center text-stone-600">
          Nothing has been published here yet.
        </div>
      )}
      {(decide.error ?? bundle.error) && (
        <p role="alert" className="text-sm text-rose-700">
          {(decide.error ?? bundle.error)?.message}
        </p>
      )}
      <ul className="space-y-4">
        {studies.map((study) => (
          <li key={study.id} aria-label={study.title} className="card overflow-hidden">
            <div className="flex flex-wrap items-start gap-3 p-4">
              <div className="mr-auto min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold">{study.title}</h2>
                  {study.status === "waiting" && (
                    <span className="badge badge-wait">Waiting to be listed</span>
                  )}
                  {study.mine && <span className="badge">From your lab</span>}
                </div>
                <p className="mt-0.5 text-sm text-stone-600">
                  {study.lab} · published {new Date(study.publishedAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {study.status === "listed" && (
                  <CopyButton study={study} teams={teams.data?.teams ?? []} />
                )}
                <button
                  type="button"
                  disabled={bundle.isPending}
                  onClick={() => bundle.mutate(study.id)}
                  className="btn"
                >
                  Replication bundle
                </button>
                {decides && study.status === "waiting" && (
                  <button
                    type="button"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: study.id, status: "listed" })}
                    className="btn btn-go"
                  >
                    List it
                  </button>
                )}
                {(study.mine || decides) && (
                  <button
                    type="button"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: study.id, status: "removed" })}
                    className="btn btn-danger-quiet"
                  >
                    Take down
                  </button>
                )}
              </div>
            </div>
            <div className="space-y-3 border-t border-stone-200 bg-stone-50 p-4">
              <p className="text-sm whitespace-pre-wrap">{study.summary}</p>
              <dl className="facts">
                <div>
                  <dt>Kind of site</dt>
                  <dd>{KINDS[study.about.kind] ?? study.about.kind}</dd>
                </div>
                <div>
                  <dt>Conditions</dt>
                  <dd>{study.about.conditions.join(", ")}</dd>
                </div>
                <div>
                  <dt>What's in it</dt>
                  <dd>
                    {study.about.cast} people, {study.about.posts} posts, {study.about.comments}{" "}
                    comments, over {study.about.days} {study.about.days === 1 ? "day" : "days"}
                  </dd>
                </div>
                <div>
                  <dt>License</dt>
                  <dd>{study.license}</dd>
                </div>
                {study.paper && (
                  <div className="col-span-2 md:col-span-4">
                    <dt>Paper</dt>
                    <dd className="break-words">{study.paper}</dd>
                  </div>
                )}
              </dl>
              {study.about.pictures.length > 0 && (
                <div className="flex gap-1">
                  {study.about.pictures.map((url) => (
                    <img
                      key={url}
                      src={url}
                      alt=""
                      loading="lazy"
                      className="h-16 w-16 rounded object-cover"
                    />
                  ))}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
