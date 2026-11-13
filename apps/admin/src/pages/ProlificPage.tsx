import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { get, send } from "../api.ts";

const REFRESH_MS = 30_000;

interface Connection {
  available: boolean;
  connected: boolean;
  name: string | null;
}

interface Rules {
  minViewMinutes?: number;
  minPostsSeen?: number;
  minActions?: number;
}

interface Submission {
  id: string;
  prolificId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  code: string;
  inStudy: "finished" | "in progress" | null;
  viewedMinutes: number | null;
  postsSeen: number | null;
  actions: number | null;
  problems: string[];
}

interface StudyState {
  role: string;
  slug: string;
  title: string;
  hasVersion: boolean;
  launched: boolean;
  surveyAfter: boolean;
  link: {
    prolificStudyId: string;
    prolificStatus: string | null;
    reviewMode: "manual" | "automatic";
    rules: Rules;
    finishedUrl: string;
    createdBy: string;
  } | null;
  submissions: Submission[] | null;
  submissionsProblem: string | null;
  actions: {
    by: string;
    action: string;
    people: number | null;
    amount: number | null;
    at: string;
  }[];
}

interface BonusSetup {
  id: string;
  people: number;
  amount: number;
  fees: number;
  vat: number;
  totalAmount: number;
}

const input = "rounded border border-stone-300 px-2 py-1.5 text-sm";
const card = "card space-y-3 p-4";
const primary = "rounded bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-40";
const secondary = "rounded border border-stone-300 px-3 py-1.5 text-sm disabled:opacity-40";
const label = "flex flex-col gap-1 text-sm font-medium";
const WAITING = "AWAITING REVIEW";

function Problem({ error }: { error: Error | null }) {
  return error ? (
    <p role="alert" className="text-sm text-rose-700">
      {error.message}
    </p>
  ) : null;
}

function ConnectCard({ connection }: { connection: Connection }) {
  const client = useQueryClient();
  const [token, setToken] = useState("");
  const refresh = () => client.invalidateQueries();

  const connect = useMutation({
    mutationFn: () => send("PUT", "/admin/prolific", { token }),
    onSuccess: async () => {
      setToken("");
      await refresh();
    },
  });
  const disconnect = useMutation({
    mutationFn: () => send("DELETE", "/admin/prolific"),
    onSuccess: refresh,
  });

  if (!connection.available) {
    return (
      <section className={card}>
        <h2 className="font-semibold">Your Prolific account</h2>
        <p className="text-sm text-stone-600">
          This server isn't set up to connect to Prolific yet. Whoever runs it needs to set
          TRUMAN_SECRET_KEY.
        </p>
      </section>
    );
  }

  if (connection.connected) {
    return (
      <section className={card}>
        <h2 className="font-semibold">Your Prolific account</h2>
        <p className="text-sm text-stone-600">
          Connected{connection.name ? ` as ${connection.name}` : ""}. Everything here happens as
          you, with what your Prolific account is allowed to do.
        </p>
        <button
          type="button"
          className={secondary}
          disabled={disconnect.isPending}
          onClick={() => disconnect.mutate()}
        >
          Disconnect
        </button>
      </section>
    );
  }

  return (
    <section className={card}>
      <h2 className="font-semibold">Connect your Prolific account</h2>
      <p className="text-sm text-stone-600">
        Each person connects their own account, so you can do here exactly what you can do on
        Prolific. Create a token in Prolific under Settings, then API tokens. It has full access to
        your account, so paste it only here. It's stored encrypted and can't be shown again.
      </p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          connect.mutate();
        }}
      >
        <label className={`${label} min-w-64 flex-1`}>
          Prolific API token
          <input
            required
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className={input}
          />
        </label>
        <button type="submit" className={primary} disabled={connect.isPending}>
          Connect
        </button>
      </form>
      <Problem error={connect.error} />
    </section>
  );
}

const numberOrUndefined = (value: string) => (value === "" ? undefined : Number(value));

/** Rules with nothing set are left out, rather than saved as zero. */
function RulesFields({ rules, onChange }: { rules: Rules; onChange: (rules: Rules) => void }) {
  const field = (key: keyof Rules, text: string) => (
    <label className={label}>
      {text}
      <input
        type="number"
        min="0"
        step={key === "minViewMinutes" ? "0.5" : "1"}
        value={rules[key] ?? ""}
        onChange={(event) => {
          const { [key]: _removed, ...rest } = rules;
          const value = numberOrUndefined(event.target.value);
          onChange(value === undefined || value === 0 ? rest : { ...rest, [key]: value });
        }}
        className={`${input} w-32`}
      />
    </label>
  );
  return (
    <div className="flex flex-wrap gap-4">
      {field("minViewMinutes", "Minutes viewing posts")}
      {field("minPostsSeen", "Posts seen")}
      {field("minActions", "Actions")}
    </div>
  );
}

const RULES_HINT =
  "Blank means no rule. Actions are posts, comments, likes, votes, flags, and follows. Not meeting a rule never rejects anyone: it means a person looks at them.";

function DraftCard({ studyId, state }: { studyId: string; state: StudyState }) {
  const client = useQueryClient();
  const projects = useQuery({
    queryKey: ["prolific-projects"],
    queryFn: () =>
      get<{ projects: { id: string; title: string; workspace: string }[] }>(
        "/admin/prolific/projects",
      ),
  });
  const [project, setProject] = useState("");
  const [name, setName] = useState(state.title);
  const [description, setDescription] = useState("");
  const [minutes, setMinutes] = useState("");
  const [reward, setReward] = useState("");
  const [places, setPlaces] = useState("");
  const [reviewMode, setReviewMode] = useState<"manual" | "automatic">("manual");
  const [rules, setRules] = useState<Rules>({});

  const create = useMutation({
    mutationFn: () =>
      send("POST", `/admin/studies/${studyId}/prolific`, {
        project,
        name,
        description,
        minutes: Number(minutes),
        reward: Math.round(Number(reward) * 100),
        places: Number(places),
        reviewMode,
        rules,
      }),
    onSuccess: () => client.invalidateQueries(),
  });

  if (!state.hasVersion) {
    return (
      <section className={card}>
        <h2 className="font-semibold">Create the study on Prolific</h2>
        <p className="text-sm text-stone-600">Save a version of this study first.</p>
      </section>
    );
  }

  return (
    <section aria-label="Create the study on Prolific" className={card}>
      <h2 className="font-semibold">Create the study on Prolific</h2>
      <p className="text-sm text-stone-600">
        This makes an unpublished draft with the right link and completion codes. Nothing is spent,
        and nobody sees it. You choose the audience and publish it on Prolific.
      </p>
      <form
        className="space-y-3"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <label className={label}>
          Prolific project
          <select
            required
            value={project}
            onChange={(event) => setProject(event.target.value)}
            className={input}
          >
            <option value="">Choose one</option>
            {projects.data?.projects.map(({ id, title, workspace }) => (
              <option key={id} value={id}>
                {workspace}: {title}
              </option>
            ))}
          </select>
        </label>
        <Problem error={projects.error} />
        <label className={label}>
          Name participants see
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={input}
          />
        </label>
        <label className={label}>
          Description participants see
          <textarea
            required
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className={input}
          />
        </label>
        <div className="flex flex-wrap gap-4">
          <label className={label}>
            Estimated minutes
            <input
              required
              type="number"
              min="1"
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
              className={`${input} w-32`}
            />
          </label>
          <label className={label}>
            Pay per person, in your Prolific currency
            <input
              required
              type="number"
              min="0.01"
              step="0.01"
              value={reward}
              onChange={(event) => setReward(event.target.value)}
              className={`${input} w-32`}
            />
          </label>
          <label className={label}>
            Number of people
            <input
              required
              type="number"
              min="1"
              value={places}
              onChange={(event) => setPlaces(event.target.value)}
              className={`${input} w-32`}
            />
          </label>
        </div>
        <fieldset className="space-y-1 text-sm">
          <legend className="font-medium">How people get approved and paid</legend>
          <label className="flex items-baseline gap-2">
            <input
              type="radio"
              checked={reviewMode === "manual"}
              onChange={() => setReviewMode("manual")}
            />
            <span>By hand, from this page. You see who met your rules first.</span>
          </label>
          <label className="flex items-baseline gap-2">
            <input
              type="radio"
              checked={reviewMode === "automatic"}
              disabled={state.surveyAfter}
              onChange={() => setReviewMode("automatic")}
            />
            <span>
              Automatically, for anyone who meets your rules when they finish. Everyone else waits
              for you.
              {state.surveyAfter &&
                " Not available here, because your study sends people to a survey before Prolific, so Truman can't choose their code."}
            </span>
          </label>
        </fieldset>
        <div className="space-y-2">
          <p className="text-sm font-medium">What you expect of someone before paying them</p>
          <RulesFields rules={rules} onChange={setRules} />
          <p className="text-xs text-stone-500">{RULES_HINT}</p>
        </div>
        <Problem error={create.error} />
        <button type="submit" className={primary} disabled={create.isPending}>
          Create the draft on Prolific
        </button>
      </form>
    </section>
  );
}

function NextSteps({ studyId, state }: { studyId: string; state: StudyState }) {
  const client = useQueryClient();
  const { link } = state;
  const [copied, setCopied] = useState(false);
  const unlink = useMutation({
    mutationFn: () => send("DELETE", `/admin/studies/${studyId}/prolific`),
    onSuccess: () => client.invalidateQueries(),
  });
  if (!link) {
    return null;
  }
  return (
    <section aria-label="On Prolific" className={card}>
      <h2 className="font-semibold">On Prolific</h2>
      <p className="text-sm text-stone-600">
        Status: {link.prolificStatus ?? "unknown"} · Created by {link.createdBy} ·{" "}
        {link.reviewMode === "manual" ? "Approved by hand" : "Approved automatically if they pass"}
      </p>
      {!state.launched && (
        <p role="status" className="text-sm text-amber-800">
          Launch this study before publishing on Prolific. Until then, the link won't let anyone in.
        </p>
      )}
      <p className="text-sm">
        Choose your audience and publish it on{" "}
        <a className="underline" href="https://app.prolific.com/" target="_blank" rel="noreferrer">
          Prolific
        </a>
        . Truman never publishes for you.
      </p>
      {state.surveyAfter ? (
        <div className="space-y-1 text-sm">
          <p>
            Your study sends people to a survey when they finish. Set that survey's end to redirect
            to this link, or they won't get credit:
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-stone-100 px-2 py-1 break-all">{link.finishedUrl}</code>
            <button
              type="button"
              className={secondary}
              onClick={async () => {
                await navigator.clipboard.writeText(link.finishedUrl);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-stone-600">
          When people finish, Truman sends them back to Prolific on its own.
        </p>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer text-stone-600">Stop linking this study</summary>
        <p className="my-2 text-stone-600">
          Nothing changes on Prolific, and anyone who finishes afterward won't be sent back
          automatically.
        </p>
        <button
          type="button"
          className={secondary}
          disabled={unlink.isPending}
          onClick={() => unlink.mutate()}
        >
          Unlink
        </button>
      </details>
    </section>
  );
}

function RulesCard({ studyId, rules }: { studyId: string; rules: Rules }) {
  const client = useQueryClient();
  const [value, setValue] = useState(rules);
  const save = useMutation({
    mutationFn: () => send("PUT", `/admin/studies/${studyId}/prolific/rules`, { rules: value }),
    onSuccess: () => client.invalidateQueries(),
  });
  return (
    <section aria-label="Your rules" className={card}>
      <h2 className="font-semibold">What you expect before paying someone</h2>
      <RulesFields rules={value} onChange={setValue} />
      <p className="text-xs text-stone-500">{RULES_HINT}</p>
      <Problem error={save.error} />
      <button
        type="button"
        className={secondary}
        disabled={save.isPending}
        onClick={() => save.mutate()}
      >
        Save rules
      </button>
      {save.isSuccess && (
        <p role="status" className="text-sm text-emerald-800">
          Saved.
        </p>
      )}
    </section>
  );
}

const money = (smallestUnit: number) => (smallestUnit / 100).toFixed(2);

function SubmissionsCard({ studyId, state }: { studyId: string; state: StudyState }) {
  const client = useQueryClient();
  const submissions = state.submissions ?? [];
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bonusEach, setBonusEach] = useState("");
  const [bonus, setBonus] = useState<BonusSetup | null>(null);
  const approveDialog = useRef<HTMLDialogElement>(null);
  const bonusDialog = useRef<HTMLDialogElement>(null);
  const refresh = () => client.invalidateQueries({ queryKey: ["prolific", studyId] });

  const chosen = submissions.filter(({ id }) => selected.has(id));
  const toApprove = chosen.filter(({ status }) => status === WAITING);
  const passing = submissions.filter(
    ({ status, problems }) => status === WAITING && problems.length === 0,
  );

  // Someone approved elsewhere shouldn't stay selected.
  useEffect(() => {
    const present = new Set(submissions.map(({ id }) => id));
    setSelected((current) => {
      const kept = [...current].filter((id) => present.has(id));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [submissions]);

  const approve = useMutation({
    mutationFn: () =>
      send<{ people: number }>("POST", `/admin/studies/${studyId}/prolific/approve`, {
        submissionIds: toApprove.map(({ id }) => id),
      }),
    onSuccess: async () => {
      setSelected(new Set());
      await refresh();
    },
    onSettled: () => approveDialog.current?.close(),
  });

  const setUp = useMutation({
    mutationFn: () =>
      send<BonusSetup>("POST", `/admin/studies/${studyId}/prolific/bonuses`, {
        submissionIds: chosen.map(({ id }) => id),
        amount: Number(bonusEach),
      }),
    onSuccess: (result) => {
      setBonus(result);
      pay.reset();
      bonusDialog.current?.showModal();
    },
  });

  const pay = useMutation({
    mutationFn: (id: string) =>
      send("POST", `/admin/studies/${studyId}/prolific/bonuses/${id}/pay`),
    onSuccess: async () => {
      setBonus(null);
      setBonusEach("");
      setSelected(new Set());
      await refresh();
    },
    onSettled: () => bonusDialog.current?.close(),
  });

  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });

  return (
    <section aria-label="Submissions" className={card}>
      <h2 className="font-semibold">Submissions</h2>
      {state.submissionsProblem ? (
        <p role="alert" className="text-sm text-rose-700">
          {state.submissionsProblem}
        </p>
      ) : submissions.length === 0 ? (
        <p className="text-sm text-stone-600">Nobody has started on Prolific yet.</p>
      ) : (
        <>
          <p className="text-sm text-stone-600">
            {passing.length} waiting for review {passing.length === 1 ? "passes" : "pass"} your
            rules. Prolific approves anything left waiting after 21 days, according to its
            documentation.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={secondary}
              disabled={passing.length === 0}
              onClick={() => setSelected(new Set(passing.map(({ id }) => id)))}
            >
              Select everyone who passes
            </button>
            <button
              type="button"
              className={primary}
              disabled={toApprove.length === 0}
              onClick={() => {
                approve.reset();
                approveDialog.current?.showModal();
              }}
            >
              Approve {toApprove.length} selected
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className={label}>
              Bonus for each selected person
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={bonusEach}
                onChange={(event) => setBonusEach(event.target.value)}
                className={`${input} w-32`}
              />
            </label>
            <button
              type="button"
              className={secondary}
              disabled={chosen.length === 0 || !(Number(bonusEach) > 0) || setUp.isPending}
              onClick={() => setUp.mutate()}
            >
              See what it costs
            </button>
          </div>
          <p className="text-xs text-stone-500">
            Bonuses are in your study's currency, so 1.50 means 1.50, not 1.50 cents.
          </p>
          <Problem error={approve.error ?? setUp.error ?? pay.error} />
          {approve.isSuccess && (
            <p role="status" className="text-sm text-emerald-800">
              Prolific accepted the approval of {approve.data.people}. It can take a few minutes to
              show here.
            </p>
          )}
          {pay.isSuccess && (
            <p role="status" className="text-sm text-emerald-800">
              Prolific accepted the bonus. It pays people within a few minutes.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="table">
              <thead className="border-b border-stone-200 text-stone-600">
                <tr>
                  <th className="px-2 py-1 font-medium">
                    <span className="sr-only">Selected</span>
                  </th>
                  <th className="px-2 py-1 font-medium">Prolific ID</th>
                  <th className="px-2 py-1 font-medium">On Prolific</th>
                  <th className="px-2 py-1 font-medium">In this study</th>
                  <th className="px-2 py-1 text-right font-medium">Minutes</th>
                  <th className="px-2 py-1 text-right font-medium">Posts</th>
                  <th className="px-2 py-1 text-right font-medium">Actions</th>
                  <th className="px-2 py-1 font-medium">Check</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((item) => (
                  <tr key={item.id} className="border-b border-stone-100 align-top">
                    <td className="px-2 py-1">
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.prolificId}`}
                        checked={selected.has(item.id)}
                        onChange={(event) => toggle(item.id, event.target.checked)}
                      />
                    </td>
                    <td className="px-2 py-1 font-mono text-xs break-all">{item.prolificId}</td>
                    <td className="px-2 py-1">
                      {item.status}
                      {item.code === "declined" && " (declined consent)"}
                    </td>
                    <td className="px-2 py-1">{item.inStudy ?? "Not found"}</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {item.viewedMinutes ?? "–"}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{item.postsSeen ?? "–"}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{item.actions ?? "–"}</td>
                    <td className="px-2 py-1">
                      {item.problems.length === 0 ? (
                        <span className="text-emerald-800">Passes</span>
                      ) : (
                        <ul className="text-amber-800">
                          {item.problems.map((problem) => (
                            <li key={problem}>{problem}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <dialog
        ref={approveDialog}
        aria-label="Confirm approval"
        className="m-auto w-[min(90vw,28rem)] rounded-lg p-6 backdrop:bg-black/50"
      >
        <h3 className="mb-2 text-lg font-semibold">Approve {toApprove.length} people?</h3>
        <p className="mb-2 text-sm">
          Approving pays them their reward from your Prolific balance. It can't be undone.
        </p>
        {toApprove.some(({ problems }) => problems.length > 0) && (
          <p className="mb-2 text-sm text-amber-800">
            {toApprove.filter(({ problems }) => problems.length > 0).length} of them didn't pass
            your rules.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className={secondary}
            onClick={() => approveDialog.current?.close()}
          >
            Cancel
          </button>
          <button
            type="button"
            className={primary}
            disabled={approve.isPending}
            onClick={() => approve.mutate()}
          >
            Approve and pay
          </button>
        </div>
      </dialog>

      <dialog
        ref={bonusDialog}
        aria-label="Confirm bonus"
        className="m-auto w-[min(90vw,28rem)] rounded-lg p-6 backdrop:bg-black/50"
      >
        <h3 className="mb-2 text-lg font-semibold">Pay a bonus to {bonus?.people} people?</h3>
        {bonus && (
          <dl className="mb-3 grid grid-cols-2 gap-1 text-sm">
            <dt>Each</dt>
            <dd className="text-right tabular-nums">{Number(bonusEach).toFixed(2)}</dd>
            <dt>Bonuses, as Prolific reports them</dt>
            <dd className="text-right tabular-nums">{money(bonus.amount)}</dd>
            <dt>Fees</dt>
            <dd className="text-right tabular-nums">{money(bonus.fees)}</dd>
            <dt>Tax</dt>
            <dd className="text-right tabular-nums">{money(bonus.vat)}</dd>
            <dt className="font-semibold">Total from your balance</dt>
            <dd className="text-right font-semibold tabular-nums">{money(bonus.totalAmount)}</dd>
          </dl>
        )}
        <p className="mb-4 text-sm">This can't be undone, and can only be sent once.</p>
        <div className="flex justify-end gap-2">
          <button type="button" className={secondary} onClick={() => bonusDialog.current?.close()}>
            Cancel
          </button>
          <button
            type="button"
            className={primary}
            disabled={pay.isPending || !bonus}
            onClick={() => bonus && pay.mutate(bonus.id)}
          >
            Pay bonus
          </button>
        </div>
      </dialog>
    </section>
  );
}

/** Recruiting a study through Prolific, as the person signed in. */
export function ProlificPage() {
  const { studyId } = useParams({ from: "/studies/$studyId/prolific" });
  const connection = useQuery({
    queryKey: ["prolific-connection"],
    queryFn: () => get<Connection>("/admin/prolific"),
  });
  const state = useQuery({
    queryKey: ["prolific", studyId],
    queryFn: () => get<StudyState>(`/admin/studies/${studyId}/prolific`),
    refetchInterval: REFRESH_MS,
  });

  return (
    <main className="page space-y-4">
      <div>
        <Link to="/studies/$studyId/monitor" params={{ studyId }} className="text-sm underline">
          Back to the monitor
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Recruit on Prolific</h1>
        {state.data && <p className="text-sm text-stone-600">{state.data.title}</p>}
      </div>
      <Problem error={state.error} />
      {connection.data && <ConnectCard connection={connection.data} />}
      {state.data && connection.data?.connected && !state.data.link && (
        <DraftCard studyId={studyId} state={state.data} />
      )}
      {state.data?.link && (
        <>
          <NextSteps studyId={studyId} state={state.data} />
          <SubmissionsCard studyId={studyId} state={state.data} />
          <RulesCard studyId={studyId} rules={state.data.link.rules} />
        </>
      )}
      {state.data && state.data.actions.length > 0 && (
        <details className={`${card} text-sm`}>
          <summary className="cursor-pointer font-medium">What's been done from here</summary>
          <ul className="space-y-0.5 text-stone-600">
            {state.data.actions.map(({ by, action, people, amount, at }) => (
              <li key={`${by}${action}${at}`}>
                {new Date(at).toLocaleString()}: {by} {action}
                {people === null ? "" : `, ${people} ${people === 1 ? "person" : "people"}`}
                {amount === null ? "" : `, ${money(amount)} total`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </main>
  );
}
