import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { type DraftSettings, get, post, send } from "../api.ts";

interface Recruiting {
  title: string;
  versionId: string;
  version: number;
  live: boolean;
  joinUrl: string;
  entry: { idParam: string; idLabel: string; source: string };
  exitRedirect: string | null;
  hasExit: boolean;
}

type Platform = "prolific" | "cloudresearch" | "sona" | "other";

/** What a platform needs the study to read, and what it calls the ID. */
const PRESETS: Record<
  Exclude<Platform, "prolific" | "other">,
  { idParam: string; idLabel: string; source: string; link: (joinUrl: string) => string }
> = {
  // Connect adds participantId, assignmentId, and projectId to the link by itself.
  cloudresearch: {
    idParam: "participantId",
    idLabel: "CloudResearch ID",
    source: "cloudresearch",
    link: (joinUrl) => joinUrl,
  },
  // SONA fills in %SURVEY_CODE% for each person, and wants it back to grant credit.
  sona: {
    idParam: "id",
    idLabel: "SONA ID",
    source: "sona",
    link: (joinUrl) => `${joinUrl}?id=%SURVEY_CODE%`,
  },
};

function Copyable({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded border border-stone-200 bg-stone-50 px-2 py-1.5 text-sm whitespace-nowrap">
          {value}
        </code>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() =>
            navigator.clipboard.writeText(value).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-sm">
      <span aria-hidden="true" className={ok ? "text-emerald-700" : "text-amber-700"}>
        {ok ? "✓" : "!"}
      </span>
      <span>
        <span className="sr-only">{ok ? "Done: " : "To change: "}</span>
        {children}
      </span>
    </li>
  );
}

/**
 * Recruiting participants (ADR 98). Prolific has its own page, which sets it up through Prolific's
 * API. Every other platform needs the same three things from a study: its link, the name of the
 * ID in it, and where people go at the end. This shows them for CloudResearch, SONA, or anywhere,
 * checks what the study does now, and makes the changes in a draft.
 */
export function RecruitPage() {
  const { studyId } = useParams({ from: "/studies/$studyId/recruit" });
  const navigate = useNavigate();
  const recruiting = useQuery({
    queryKey: ["recruiting", studyId],
    queryFn: () => get<Recruiting>(`/admin/studies/${studyId}/recruiting`),
  });
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [completion, setCompletion] = useState("");
  const [other, setOther] = useState<{ idParam: string; idLabel: string; source: string } | null>(
    null,
  );

  const apply = useMutation({
    mutationFn: async (change: {
      entry: { idParam: string; idLabel: string; source: string };
      redirect: string | null;
    }) => {
      const data = recruiting.data as Recruiting;
      const { draftId } = await post<{ draftId: string }>(
        `/admin/versions/${data.versionId}/draft`,
        {},
      );
      const settings = await get<DraftSettings>(`/admin/drafts/${draftId}/settings`);
      const { revision, value } = settings.sections.flow;
      const hasExit = value.flow.some(({ step }) => step === "exit");
      const exit = {
        step: "exit" as const,
        ...(change.redirect ? { redirect: change.redirect } : {}),
      };
      const flow = hasExit
        ? value.flow.map((step) => (step.step === "exit" && change.redirect ? exit : step))
        : [...value.flow, exit];
      await send("PUT", `/admin/drafts/${draftId}/settings`, {
        section: "flow",
        value: { ...value, entry: change.entry, flow },
        baseRevision: revision,
      });
      return draftId;
    },
    onSuccess: (draftId) => navigate({ to: "/drafts/$draftId/settings", params: { draftId } }),
  });

  if (!recruiting.data) {
    return null;
  }
  const data = recruiting.data;
  const choice = (key: Platform, title: string, about: string) => (
    <label
      className={`card flex cursor-pointer gap-3 p-3 ${platform === key ? "ring-2 ring-accent" : ""}`}
    >
      <input
        type="radio"
        name="platform"
        checked={platform === key}
        onChange={() => {
          setPlatform(key);
          setCompletion("");
        }}
      />
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-stone-600">{about}</span>
      </span>
    </label>
  );

  const preset =
    platform === "cloudresearch" || platform === "sona"
      ? PRESETS[platform]
      : platform === "other"
        ? (other ?? data.entry)
        : null;
  // SONA's credit link ends in survey_code=XXXX, which has to be the person's own code.
  const redirect =
    platform === "sona" ? completion.replace(/XXXX/g, "{externalId}") : completion.trim();
  const entryMatches =
    preset !== null &&
    data.entry.idParam === preset.idParam &&
    data.entry.idLabel === preset.idLabel &&
    data.entry.source === preset.source;
  const exitMatches = redirect ? data.exitRedirect === redirect : Boolean(data.exitRedirect);

  return (
    <main className="page max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Recruit participants</h1>
        <p className="text-stone-600">
          {data.title}, version {data.version}
          {data.live ? ", which is open to participants" : ", which isn't open to participants yet"}
          .
        </p>
      </div>
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="mb-2 font-medium">Where are you recruiting?</legend>
        {choice(
          "prolific",
          "Prolific",
          "Truman makes the study on Prolific and handles the codes.",
        )}
        {choice("cloudresearch", "CloudResearch Connect", "Paste the study's link into Connect.")}
        {choice("sona", "SONA", "A university's participant pool, for course credit.")}
        {choice("other", "Somewhere else", "Any platform that can add an ID to a link.")}
      </fieldset>

      {platform === "prolific" && (
        <div className="card space-y-2 p-4">
          <p>
            Truman connects to your Prolific account, makes the study there with the right link and
            completion codes, and lets you review and approve people.
          </p>
          <Link to="/studies/$studyId/prolific" params={{ studyId }} className="btn btn-primary">
            Recruit on Prolific
          </Link>
        </div>
      )}

      {preset && (
        <section aria-label="Setting it up" className="card space-y-4 p-4">
          {platform === "other" && (
            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  ["idParam", "The ID's name in the link"],
                  ["idLabel", "What it's called"],
                  ["source", "Recorded as"],
                ] as const
              ).map(([field, label]) => (
                <label key={field} className="flex flex-col gap-1 text-sm font-medium">
                  {label}
                  <input
                    value={preset[field]}
                    onChange={(event) => setOther({ ...preset, [field]: event.target.value })}
                    className="rounded border border-stone-300 px-2 py-1.5 font-normal"
                  />
                </label>
              ))}
            </div>
          )}
          <Copyable
            label={
              platform === "cloudresearch"
                ? "1. In Connect, make this the project's URL. Connect adds each person's ID to it."
                : platform === "sona"
                  ? "1. In SONA, make this the study's URL. SONA puts each person's code where %SURVEY_CODE% is."
                  : `1. Give out this link, with each person's ID after ${preset.idParam}=.`
            }
            value={
              platform === "other"
                ? `${data.joinUrl}?${preset.idParam}=`
                : PRESETS[platform as "cloudresearch" | "sona"].link(data.joinUrl)
            }
          />
          <label className="flex flex-col gap-1 text-sm font-medium">
            {platform === "cloudresearch"
              ? "2. Paste the completion redirect Connect shows you when you set up the project."
              : platform === "sona"
                ? "2. Paste SONA's \"client-side completion URL\". Truman puts each person's code where it says XXXX."
                : "2. Paste where people go when they finish. {externalId} is replaced by their ID."}
            <input
              type="url"
              value={completion}
              onChange={(event) => setCompletion(event.target.value)}
              placeholder="https://"
              className="rounded border border-stone-300 px-2 py-1.5 font-normal"
            />
          </label>
          <div>
            <p className="text-sm font-medium">3. What the study does now</p>
            <ul className="mt-1 space-y-1">
              <Check ok={entryMatches}>
                It reads the ID from <code>{data.entry.idParam}</code>, calls it “
                {data.entry.idLabel}”, and records it as <code>{data.entry.source}</code>.
                {!entryMatches && (
                  <>
                    {" "}
                    It should read <code>{preset.idParam}</code>, called “{preset.idLabel}”,
                    recorded as <code>{preset.source}</code>.
                  </>
                )}
              </Check>
              <Check ok={exitMatches}>
                {data.exitRedirect ? (
                  <>
                    At the end it sends people to{" "}
                    <code className="break-all">{data.exitRedirect}</code>.
                  </>
                ) : (
                  "At the end it doesn't send people anywhere."
                )}
              </Check>
            </ul>
          </div>
          {(!entryMatches || (redirect && !exitMatches)) && (
            <div className="space-y-2">
              <button
                type="button"
                disabled={apply.isPending}
                onClick={() =>
                  apply.mutate({
                    entry: {
                      idParam: preset.idParam,
                      idLabel: preset.idLabel,
                      source: preset.source,
                    },
                    redirect: redirect || null,
                  })
                }
                className="btn btn-primary"
              >
                {apply.isPending ? "Changing..." : "Make these changes in a draft"}
              </button>
              <p className="text-sm text-stone-600">
                This opens a draft of version {data.version} with the changes made, on its Settings
                page. Save it as a new version and launch that, as with any change.
              </p>
              {apply.error && (
                <p role="alert" className="text-sm text-rose-800">
                  {apply.error.message}
                </p>
              )}
            </div>
          )}
          {platform === "cloudresearch" && (
            <p className="text-sm text-stone-600">
              Truman can't approve people on Connect for you, as it does on Prolific. Download the
              data and match <code>recruitment_ids.csv</code> to Connect's list of submissions.
            </p>
          )}
        </section>
      )}
    </main>
  );
}
