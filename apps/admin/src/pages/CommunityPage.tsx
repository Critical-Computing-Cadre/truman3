import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { type DraftInfo, get, post, send } from "../api.ts";

interface Run {
  id: string;
  status: "running" | "done" | "error";
  progress: { days: number; of: number; posts: number; replies: number; dropped: number };
  costUsd: number;
  model: string;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/** The community written while the study runs, as beats.yaml has it (ADR 102). */
interface Live {
  live: boolean;
  hold: boolean;
  about: string;
  topics: string[];
  postsPerDay: number;
  repliesPerPost: number;
  daysBefore: number;
  daysDuring: number;
  cast: string[];
  neverSay: string[];
  conditions: { mode: "same" } | { mode: "each"; about: Record<string, string> };
}

const field = "flex flex-col gap-1 text-sm font-medium";
const input = "rounded border border-stone-300 px-2 py-1.5 font-normal";
const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/**
 * A community by the cast, written by a model from the researcher's description. Drafted ahead
 * (ADR 99), it lands in the draft as posts and replies to read and change before saving a version.
 * Live (ADR 102), it's written while the study runs, a day ahead, and nobody reads it first unless
 * each day is held for approval.
 */
export function CommunityPage() {
  const { draftId } = useParams({ from: "/drafts/$draftId/community" });
  const client = useQueryClient();
  const info = useQuery({
    queryKey: ["draft", draftId, "info"],
    queryFn: () => get<DraftInfo>(`/admin/drafts/${draftId}`),
  });
  const state = useQuery({
    queryKey: ["draft", draftId, "community"],
    queryFn: () =>
      get<{ run: Run | null; live: Live | null; liveBudgetUsd: number }>(
        `/admin/drafts/${draftId}/community`,
      ),
    // Every two seconds while one's being written.
    refetchInterval: (query) => (query.state.data?.run?.status === "running" ? 2000 : false),
  });
  const [about, setAbout] = useState("");
  const [topics, setTopics] = useState("");
  const [postsPerDay, setPostsPerDay] = useState(6);
  const [repliesPerPost, setRepliesPerPost] = useState(3);
  const [daysBefore, setDaysBefore] = useState(2);
  const [daysDuring, setDaysDuring] = useState(1);
  const [neverSay, setNeverSay] = useState("");
  const [left, setLeft] = useState<string[]>([]);
  const [each, setEach] = useState(false);
  const [perCondition, setPerCondition] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"ahead" | "live">("ahead");
  const [hold, setHold] = useState(false);
  // A live community that's already saved fills in the form.
  const saved = state.data?.live ?? null;
  const allActors = info.data?.actors;
  useEffect(() => {
    if (!saved || !allActors) {
      return;
    }
    setAbout(saved.about);
    setTopics(saved.topics.join("\n"));
    setPostsPerDay(saved.postsPerDay);
    setRepliesPerPost(saved.repliesPerPost);
    setDaysBefore(saved.daysBefore);
    setDaysDuring(saved.daysDuring);
    setNeverSay(saved.neverSay.join("\n"));
    setLeft(
      saved.cast.length === 0
        ? []
        : allActors
            .map(({ username }) => username)
            .filter((username) => !saved.cast.includes(username)),
    );
    setEach(saved.conditions.mode === "each");
    setPerCondition(saved.conditions.mode === "each" ? saved.conditions.about : {});
    setHold(saved.hold);
    setMode(saved.live ? "live" : "ahead");
  }, [saved, allActors]);

  const refresh = () => client.invalidateQueries({ queryKey: ["draft", draftId] });
  const brief = () => ({
    about,
    topics: lines(topics),
    postsPerDay,
    repliesPerPost,
    daysBefore,
    daysDuring,
    // Everyone is an empty list, so people added to the cast later take part too.
    cast:
      left.length === 0
        ? []
        : (info.data?.actors ?? [])
            .map(({ username }) => username)
            .filter((username) => !left.includes(username)),
    neverSay: lines(neverSay),
    conditions: each ? { mode: "each", about: perCondition } : { mode: "same" },
  });
  const start = useMutation({
    mutationFn: () => post(`/admin/drafts/${draftId}/community`, brief()),
    onSuccess: refresh,
  });
  const saveLive = useMutation({
    mutationFn: (live: boolean) =>
      send("PUT", `/admin/drafts/${draftId}/community/live`, { ...brief(), live, hold }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (runId: string) => send("DELETE", `/admin/drafts/${draftId}/community/${runId}`),
    onSuccess: refresh,
  });

  const run = state.data?.run ?? null;
  const running = run?.status === "running";
  const actors = info.data?.actors ?? [];
  const conditions = info.data?.conditions ?? [];
  const canEdit = info.data?.canEdit && !info.data.closed;

  return (
    <main className="page max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Community</h1>
        <p className="text-stone-600">
          Describe the community, and a model writes days of posts and replies by your cast, before
          participants arrive and while they're there. It can be drafted now, for you to read and
          change before you save a version, or written while the study runs. The moments that matter
          stay as beats.
        </p>
      </div>

      {saved?.live && (
        <section aria-label="Live community" className="card space-y-2 p-4">
          <p className="font-semibold">A live community is on in this draft</p>
          <p className="text-sm text-stone-700">
            When this is saved as a version and launched, the community below is written{" "}
            {saved.daysBefore > 0 &&
              `for ${saved.daysBefore} ${saved.daysBefore === 1 ? "day" : "days"} before participants arrive and `}
            for {saved.daysDuring} {saved.daysDuring === 1 ? "day" : "days"} while they're there.{" "}
            {saved.hold
              ? "Each day waits on the Monitor page for you to approve it."
              : "Nobody reads it before participants do."}
          </p>
          {canEdit && (
            <button
              type="button"
              disabled={saveLive.isPending}
              onClick={() => saveLive.mutate(false)}
              className="btn btn-danger-quiet"
            >
              Turn it off
            </button>
          )}
        </section>
      )}

      {run && (
        <section aria-label="Latest draft" className="card space-y-2 p-4">
          <p className="font-semibold">
            {running
              ? `Writing day ${Math.min(run.progress.days + 1, run.progress.of)} of ${run.progress.of}...`
              : run.status === "done"
                ? "Drafted"
                : "Stopped"}
          </p>
          <p className="text-sm text-stone-700">
            {run.progress.posts} posts and {run.progress.replies} replies so far.
            {run.progress.dropped > 0 &&
              ` ${run.progress.dropped} lines the check didn't allow were left out.`}{" "}
            It cost ${run.costUsd.toFixed(2)}, counted against your lab's budget.
          </p>
          {run.error && (
            <p role="alert" className="text-sm text-rose-800">
              {run.error}
            </p>
          )}
          {!running && (
            <div className="flex flex-wrap gap-2">
              <Link to="/drafts/$draftId" params={{ draftId }} className="btn btn-primary">
                Read it on the Feed page
              </Link>
              {canEdit && run.progress.posts + run.progress.replies > 0 && (
                <button
                  type="button"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(run.id)}
                  className="btn btn-danger-quiet"
                >
                  {remove.isSuccess ? "Taken out" : "Take out what this wrote"}
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {canEdit && (
        <form
          className="card space-y-4 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (mode === "live") {
              saveLive.mutate(true);
            } else {
              start.mutate();
            }
          }}
        >
          <label className={field}>
            What is this community, and what's it like?
            <textarea
              required
              minLength={20}
              rows={4}
              value={about}
              onChange={(event) => setAbout(event.target.value)}
              placeholder="Neighbors in a small town, swapping news, recipes, and complaints about the roads. Mostly friendly."
              className={input}
            />
          </label>
          <label className={field}>
            What people talk about (one a line, most common first)
            <textarea
              rows={3}
              value={topics}
              onChange={(event) => setTopics(event.target.value)}
              className={input}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-4">
            {(
              [
                ["Posts a day", postsPerDay, setPostsPerDay, 1, 30],
                ["Replies a post, at most", repliesPerPost, setRepliesPerPost, 0, 10],
                ["Days before they arrive", daysBefore, setDaysBefore, 0, 14],
                ["Days while they're there", daysDuring, setDaysDuring, 0, 30],
              ] as const
            ).map(([label, value, set, min, max]) => (
              <label key={label} className={field}>
                {label}
                <input
                  type="number"
                  min={min}
                  max={max}
                  value={value}
                  onChange={(event) => set(Number(event.target.value))}
                  className={input}
                />
              </label>
            ))}
          </div>
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Who takes part</legend>
            <p className="text-sm text-stone-600">
              Persona cards in beats.yaml shape how each person writes.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {actors.map(({ username, name }) => (
                <label key={username} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={!left.includes(username)}
                    onChange={(event) =>
                      setLeft(
                        event.target.checked
                          ? left.filter((item) => item !== username)
                          : [...left, username],
                      )
                    }
                  />
                  {name || username}
                </label>
              ))}
            </div>
          </fieldset>
          <label className={field}>
            What must never be said (one a line), beyond Truman's own limits
            <textarea
              rows={2}
              value={neverSay}
              onChange={(event) => setNeverSay(event.target.value)}
              className={input}
            />
          </label>
          {conditions.length > 1 && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Conditions</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={!each} onChange={() => setEach(false)} />
                The same community in every condition
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={each} onChange={() => setEach(true)} />A different
                community for each condition
              </label>
              {each &&
                conditions.map(({ key }) => (
                  <label key={key} className={field}>
                    What's different in “{key}”
                    <input
                      value={perCondition[key] ?? ""}
                      onChange={(event) =>
                        setPerCondition({ ...perCondition, [key]: event.target.value })
                      }
                      placeholder="People are patient with each other."
                      className={input}
                    />
                  </label>
                ))}
            </fieldset>
          )}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">When it's written</legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                className="mt-1"
                checked={mode === "ahead"}
                onChange={() => setMode("ahead")}
              />
              <span>
                <span className="font-medium">Now, for you to read.</span> It lands in this draft as
                ordinary posts, and is the same for every participant. Nothing a model wrote reaches
                anyone unread.
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                className="mt-1"
                checked={mode === "live"}
                onChange={() => setMode("live")}
              />
              <span>
                <span className="font-medium">While the study runs.</span> Each day is written the
                day before the first participant reaches it. Everyone in a condition still sees the
                same posts at the same point in their own study.
              </span>
            </label>
            {mode === "live" && (
              <div className="ml-6 space-y-2">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={hold}
                    onChange={(event) => setHold(event.target.checked)}
                  />
                  <span>
                    Hold each day until someone on the team approves it, on the Monitor page.
                    Participants who get to a day that isn't approved see nothing from it.
                  </span>
                </label>
                {!hold && (
                  <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">
                    Without that, participants see what the model wrote without anyone reading it
                    first. Every line is still checked by a second call against your limits and
                    Truman's, and you can take posts out on the Monitor page.
                  </p>
                )}
              </div>
            )}
          </fieldset>
          <p className="text-sm text-stone-600">
            Each day is two calls to the study's model: one to write it, and one to check every line
            against your limits and Truman's.{" "}
            {mode === "live"
              ? `A live community spends from the study's budget for live writing, which is $${state.data?.liveBudgetUsd ?? 5} (live.budgetUsd in beats.yaml), and stops when that's used up or live writing is paused.`
              : "What it costs is counted against your lab's budget, as rehearsing is."}
          </p>
          {(mode === "live" ? saveLive.error : start.error) && (
            <p role="alert" className="text-sm text-rose-800">
              {(mode === "live" ? saveLive.error : start.error)?.message}
            </p>
          )}
          {mode === "live" ? (
            <button
              type="submit"
              disabled={saveLive.isPending || about.trim().length < 20 || daysDuring < 1}
              className="btn btn-primary"
            >
              {saved?.live ? "Save the live community" : "Turn on the live community"}
            </button>
          ) : (
            <button
              type="submit"
              disabled={running || start.isPending || about.trim().length < 20}
              className="btn btn-primary"
            >
              {running ? "Drafting..." : "Draft the community"}
            </button>
          )}
        </form>
      )}
    </main>
  );
}
