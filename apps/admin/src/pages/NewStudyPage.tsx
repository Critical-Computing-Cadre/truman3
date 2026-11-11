import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { TEMPLATES, type TemplateKey } from "@truman3/core";
import { type FormEvent, useState } from "react";
import { type ContentPack, get, post } from "../api.ts";
import { TemplateCards } from "../components/TemplateCards.tsx";

const input = "rounded border border-stone-300 px-2 py-1.5 text-sm";
const labelClass = "flex flex-col gap-1 text-sm font-medium";
const hint = "text-xs font-normal text-stone-500";

const toLinkName = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

function PackChoice({
  pack,
  chosen,
  onChoose,
}: {
  pack: ContentPack;
  chosen: boolean;
  onChoose: () => void;
}) {
  return (
    <label
      className={`block cursor-pointer rounded-lg border p-3 ${chosen ? "border-stone-900 bg-white" : "border-stone-200 bg-white"}`}
    >
      <span className="flex items-baseline gap-2">
        <input type="radio" name="start" checked={chosen} onChange={onChoose} />
        <span className="font-medium">{pack.name}</span>
        <span className="text-xs text-stone-500">{pack.team ?? "Available to everyone here"}</span>
      </span>
      {pack.description && <p className="mt-1 text-sm text-stone-600">{pack.description}</p>}
      <p className="mt-1 text-xs text-stone-500">
        {pack.actors} people, {pack.posts} posts, {pack.comments} comments
      </p>
      {pack.imageUrls.length > 0 && (
        <span className="mt-2 flex gap-1">
          {pack.imageUrls.map((url) => (
            <img
              key={url}
              src={url}
              alt=""
              loading="lazy"
              className="h-16 w-16 rounded object-cover"
            />
          ))}
        </span>
      )}
    </label>
  );
}

interface Starter {
  template: TemplateKey;
  actors: number;
  posts: number;
  comments: number;
  imageUrls: string[];
}

/** Made-up content for the kind of platform chosen, to try it out without building anything. */
function SampleChoice({
  starter,
  chosen,
  onChoose,
}: {
  starter: Starter;
  chosen: boolean;
  onChoose: () => void;
}) {
  return (
    <label
      className={`block cursor-pointer rounded-lg border bg-white p-3 ${chosen ? "border-stone-900" : "border-stone-200"}`}
    >
      <span className="flex items-baseline gap-2">
        <input type="radio" name="start" checked={chosen} onChange={onChoose} />
        <span className="font-medium">Sample content for {TEMPLATES[starter.template].name}</span>
      </span>
      <p className="mt-1 text-sm text-stone-600">
        Made-up people, posts, and pictures that use what this kind of platform has, to try it out
        or start from. It's copied in, so you can change or delete any of it.
      </p>
      <p className="mt-1 text-xs text-stone-500">
        {starter.actors} people, {starter.posts} posts, {starter.comments} comments
      </p>
      {starter.imageUrls.length > 0 && (
        <span className="mt-2 flex gap-1">
          {starter.imageUrls.map((url) => (
            <img
              key={url}
              src={url}
              alt=""
              loading="lazy"
              className="h-16 w-16 rounded object-cover"
            />
          ))}
        </span>
      )}
    </label>
  );
}

export function NewStudyPage() {
  const navigate = useNavigate();
  const list = useQuery({
    queryKey: ["packs"],
    queryFn: () =>
      get<{
        teams: { id: string; name: string }[];
        packs: ContentPack[];
        starters: Starter[];
      }>("/admin/packs"),
  });

  const [title, setTitle] = useState("");
  const [typedSlug, setTypedSlug] = useState<string | null>(null);
  const [teamChoice, setTeamChoice] = useState<string | null>(null);
  const [packId, setPackId] = useState<string | null>(null);
  /** Sample content for the kind of platform chosen, instead of a pack or nothing. */
  const [sample, setSample] = useState(false);
  const [keep, setKeep] = useState<"everything" | "background">("everything");
  const [assignment, setAssignment] = useState<"uniform" | "blocked" | null>(null);
  /** Left alone, a pack keeps the platform it came with, and anything else is Classic. */
  const [template, setTemplate] = useState<TemplateKey | null>(null);
  /** An optional brief for an agent, which starts drafting once the study exists. ADR 65. */
  const [brief, setBrief] = useState("");

  const slug = typedSlug ?? toLinkName(title);
  const teams = list.data?.teams ?? [];
  const teamId = teamChoice ?? teams[0]?.id ?? "";
  const pack = sample ? undefined : list.data?.packs.find(({ id }) => id === packId);
  const starter = list.data?.starters.find((item) => item.template === (template ?? "classic"));
  const withSample = sample && starter !== undefined;

  const start = useMutation({
    mutationFn: async () => {
      const made = await post<{ draftId: string }>("/admin/studies", {
        teamId,
        title,
        slug,
        assignment,
        packId: withSample ? null : packId,
        ...(withSample ? { starter: true } : {}),
        ...(pack ? { keep } : {}),
        ...(template ? { template } : {}),
      });
      if (brief.trim()) {
        // The study exists either way. Without a Claude key, the Agent page says so.
        await post(`/admin/drafts/${made.draftId}/agent`, { brief: brief.trim() }).catch(() => {});
      }
      return made;
    },
    onSuccess: ({ draftId }) =>
      brief.trim()
        ? navigate({ to: "/drafts/$draftId/agent", params: { draftId } })
        : navigate({ to: "/drafts/$draftId", params: { draftId } }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    start.mutate();
  };

  if (!list.data) {
    return null;
  }
  if (teams.length === 0) {
    return (
      <main className="mx-auto max-w-2xl p-4">
        <p>You can only view studies on your team, so you can't start one.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-4">
      <Link to="/" className="text-sm underline">
        Back to studies
      </Link>
      <h1 className="mt-2 mb-4 text-2xl font-semibold">New study</h1>

      <form onSubmit={submit} className="space-y-5">
        <label className={labelClass}>
          Title
          <input
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={input}
          />
          <span className={hint}>Only researchers see this.</span>
        </label>
        <label className={labelClass}>
          Link name
          <input
            required
            pattern="[a-z0-9][a-z0-9_\-]*"
            title="Lowercase letters, numbers, dashes, and underscores"
            value={slug}
            onChange={(event) => setTypedSlug(event.target.value)}
            className={input}
          />
          <span className={hint}>
            Participants join at /join/{slug || "…"}. This can't change later.
          </span>
        </label>
        {teams.length > 1 && (
          <label className={labelClass}>
            Team
            <select
              value={teamId}
              onChange={(event) => setTeamChoice(event.target.value)}
              className={input}
            >
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">What kind of platform is it?</legend>
          <TemplateCards chosen={template ?? "classic"} onChoose={setTemplate} />
          <p className={hint}>
            This can't change once the study starts. What's on it can, in Settings.
            {pack && !template ? " Left alone, a pack keeps the platform it came with." : ""}
          </p>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Where do you want to start?</legend>
          <p className={hint}>
            A pack is copied into your study, and then it's yours to change. Nothing that happens to
            the pack later can affect your study.
          </p>
          {starter && (
            <SampleChoice
              starter={starter}
              chosen={withSample}
              onChoose={() => {
                setSample(true);
                setPackId(null);
              }}
            />
          )}
          <label
            className={`block cursor-pointer rounded-lg border bg-white p-3 ${packId === null && !withSample ? "border-stone-900" : "border-stone-200"}`}
          >
            <span className="flex items-baseline gap-2">
              <input
                type="radio"
                name="start"
                checked={packId === null && !withSample}
                onChange={() => {
                  setSample(false);
                  setPackId(null);
                }}
              />
              <span className="font-medium">Start with nothing</span>
            </span>
            <p className="mt-1 text-sm text-stone-600">Add your own people and posts.</p>
          </label>
          {list.data.packs.map((item) => (
            <PackChoice
              key={item.id}
              pack={item}
              chosen={!withSample && packId === item.id}
              onChoose={() => {
                setSample(false);
                setPackId(item.id);
              }}
            />
          ))}
        </fieldset>

        {pack && pack.targeted > 0 && (
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">What do you want from this pack?</legend>
            <label className="flex items-baseline gap-2 text-sm">
              <input
                type="radio"
                name="keep"
                checked={keep === "everything"}
                onChange={() => setKeep("everything")}
              />
              <span>
                All of it, with its {pack.conditions.length} conditions{" "}
                <span className={hint}>({pack.conditions.join(", ")})</span>
              </span>
            </label>
            <label className="flex items-baseline gap-2 text-sm">
              <input
                type="radio"
                name="keep"
                checked={keep === "background"}
                onChange={() => setKeep("background")}
              />
              <span>
                Just the background{" "}
                <span className={hint}>
                  Leaves out {pack.targeted} items limited to a condition, for adding your own.
                </span>
              </span>
            </label>
          </fieldset>
        )}

        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">How are people assigned to conditions?</legend>
          <label className="flex items-baseline gap-2 text-sm">
            <input
              type="radio"
              name="assignment"
              required
              checked={assignment === "uniform"}
              onChange={() => setAssignment("uniform")}
            />
            <span>
              Uniform{" "}
              <span className={hint}>
                Each person is assigned at random, so counts can drift apart.
              </span>
            </span>
          </label>
          <label className="flex items-baseline gap-2 text-sm">
            <input
              type="radio"
              name="assignment"
              checked={assignment === "blocked"}
              onChange={() => setAssignment("blocked")}
            />
            <span>
              Blocked{" "}
              <span className={hint}>
                Random within blocks, which keeps the counts close together.
              </span>
            </span>
          </label>
        </fieldset>

        <label className="block space-y-1">
          <span className="font-medium">Draft from a brief (optional)</span>
          <span className="block text-sm text-stone-600">
            Describe the study, and an agent drafts it for you to review: the cast, posts, beats,
            and tests. It runs on the server within a $2 budget, and what it writes is marked as
            generated. Leave this empty to start the study yourself.
          </span>
          <textarea
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            rows={4}
            maxLength={8000}
            placeholder="A cyberbullying bystander study, photo platform, two conditions: someone defends the person being mocked, or nobody does."
            className="w-full rounded border border-stone-300 p-2 text-sm"
          />
        </label>

        {start.error && (
          <p role="alert" className="text-sm text-rose-700">
            {start.error.message}
          </p>
        )}
        <button
          type="submit"
          disabled={start.isPending || !title.trim() || !slug || !assignment}
          className="rounded bg-stone-900 px-4 py-2 text-sm text-white disabled:opacity-40"
        >
          {start.isPending ? "Starting..." : "Start the study"}
        </button>
      </form>
    </main>
  );
}
