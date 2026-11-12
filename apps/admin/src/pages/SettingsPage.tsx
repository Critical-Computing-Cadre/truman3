import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import {
  contrast,
  DEFAULT_TEMPLATE,
  FEATURE_KEYS,
  FEATURES,
  type FeatureKey,
  fillLinkTemplate,
  LAYOUT_ACCENTS,
  type StudySettings,
  TEMPLATES,
  type TemplateDefinition,
} from "@truman3/core";
import { type ReactNode, useState } from "react";
import Markdown from "react-markdown";
import { type DraftSections, type DraftSettings, get, send } from "../api.ts";
import { RecentChanges, useDraftPresence } from "./DraftPage.tsx";

type Others = ReturnType<typeof useDraftPresence>;
type Arm = StudySettings["conditions"]["arms"][number];
type Step = StudySettings["flow"][number];

const input = "rounded border border-stone-300 px-2 py-1.5 text-sm disabled:bg-stone-100";
const smallButton = "rounded border border-stone-300 px-2 py-1 text-xs disabled:opacity-40";
const labelClass = "flex flex-col gap-1 text-sm font-medium";

function Hint({ children }: { children: ReactNode }) {
  return <span className="text-xs font-normal text-stone-500">{children}</span>;
}

/**
 * The site's main color: its name, links, and buttons. Each kind of site has its own, and a study
 * can pick another, to look like a different site or to match its logo.
 */
function MainColor({
  value,
  own,
  onChange,
}: {
  value: string | undefined;
  /** The color this kind of site comes with. */
  own: string;
  onChange: (value: string | undefined) => void;
}) {
  const pale = value !== undefined && contrast(value, "#ffffff") < 3;
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">Main color</legend>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <input
          type="color"
          aria-label="Main color"
          value={value ?? own}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-14 cursor-pointer rounded border border-stone-300 bg-white p-0.5"
        />
        <code>{value ?? own}</code>
        {value !== undefined && (
          <button type="button" onClick={() => onChange(undefined)} className="underline">
            Use this kind of site's own color
          </button>
        )}
      </div>
      <Hint>
        For the site's name, links, and buttons. Each kind of site comes with its own.
        {pale && " This one is pale, so words in it will be hard to read on a white page."}
      </Hint>
    </fieldset>
  );
}

function Choice<T extends string>({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string;
  value: T;
  options: { value: T; label: string; hint: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className="flex items-baseline gap-2 text-sm">
          <input
            type="radio"
            name={legend}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span>
            {option.label} <Hint>{option.hint}</Hint>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** A number box where blank means the setting is off. */
function OptionalNumber({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <label className={labelClass}>
      {label}
      <input
        type="number"
        min="0"
        step="any"
        value={value ?? ""}
        onChange={(event) =>
          onChange(event.target.value === "" ? undefined : Number(event.target.value))
        }
        className={`${input} w-32`}
      />
      <Hint>{hint}</Hint>
    </label>
  );
}

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

/**
 * Text that stands for a value, like "1, 1, 2". What's typed stays as typed, even partway through
 * something that doesn't parse yet, until the value changes some other way, like being discarded.
 */
function useTextFor<T>(value: T, format: (value: T) => string, parse: (text: string) => T | null) {
  const [typed, setTyped] = useState(() => format(value));
  const parsed = parse(typed);
  const inStep = parsed === null || JSON.stringify(parsed) === JSON.stringify(value);
  return { text: inStep ? typed : format(value), setText: setTyped, parse };
}

/** Holds someone's unsaved edit. Until they make one, it follows what's saved, including others' changes. */
function useEdit<T>(saved: { revision: number; value: T }) {
  const [edit, setEdit] = useState<{ value: T; base: number } | null>(null);
  const value = edit?.value ?? saved.value;
  return {
    value,
    set: (next: T) => setEdit({ value: next, base: edit?.base ?? saved.revision }),
    base: edit?.base ?? saved.revision,
    dirty: edit !== null && JSON.stringify(edit.value) !== JSON.stringify(saved.value),
    // They've got unsaved work, and someone has saved over the version it started from.
    overtaken: edit !== null && edit.base !== saved.revision,
    reset: () => setEdit(null),
  };
}

function SaveBar({
  dirty,
  overtaken,
  saving,
  error,
  problem,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  overtaken: boolean;
  saving: boolean;
  error: Error | null;
  problem?: string | null | undefined;
  onSave: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="space-y-2 border-t border-stone-200 pt-3">
      {overtaken && (
        <p role="alert" className="rounded bg-amber-50 p-2 text-sm text-amber-900">
          Someone else saved this while you were editing it. Discard your changes to see theirs.
        </p>
      )}
      {!overtaken && (problem || error) && (
        <p role="alert" className="text-sm text-rose-700">
          {problem ?? error?.message}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!dirty || saving || overtaken || Boolean(problem)}
          onClick={(event) => {
            event.preventDefault();
            onSave();
          }}
          className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
        >
          Save changes
        </button>
        {(dirty || overtaken) && (
          <button type="button" onClick={onDiscard} className={smallButton}>
            Discard
          </button>
        )}
      </div>
    </div>
  );
}

function useSaver(draftId: string, section: string, onSaved: () => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { value: unknown; baseRevision: number; renames?: object }) =>
      send("PUT", `/admin/drafts/${draftId}/settings`, { section, ...body }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["draft", draftId] });
      onSaved();
    },
  });
}

/** One card of settings, which saves on its own. */
function Section<K extends keyof DraftSections>({
  draftId,
  name,
  title,
  intro,
  settings,
  others,
  onFocus,
  check,
  toSave,
  children,
}: {
  draftId: string;
  name: K;
  title: string;
  intro: string;
  settings: DraftSettings;
  others: Others;
  onFocus: (section: string) => void;
  /** What's wrong with it, to catch before trying to save. */
  check?: (value: DraftSections[K]) => string | null;
  /** Turns what's being edited into what gets saved. */
  toSave?: (value: DraftSections[K]) => { value: unknown; renames?: object };
  children: (value: DraftSections[K], set: (value: DraftSections[K]) => void) => ReactNode;
}) {
  const saved = settings.sections[name] as { revision: number; value: DraftSections[K] };
  const edit = useEdit(saved);
  const save = useSaver(draftId, name, edit.reset);
  const editors = others.filter(({ section }) => section === name);

  return (
    <section
      aria-label={title}
      onFocusCapture={() => onFocus(name)}
      className="space-y-4 rounded-lg bg-white p-4 shadow-sm"
    >
      <header>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-stone-500">{intro}</p>
        {editors.length > 0 && (
          <p className="mt-1 inline-block rounded bg-sky-100 px-2 py-0.5 text-xs text-sky-900">
            {editors.map((person) => person.name).join(", ")} editing this
          </p>
        )}
      </header>
      <form className="space-y-4" onSubmit={(event) => event.preventDefault()}>
        {/* Saving ends by following what's saved, so a change made meanwhile would be lost. */}
        <fieldset disabled={!settings.canEdit || save.isPending} className="space-y-4">
          {children(edit.value, edit.set)}
        </fieldset>
        {settings.canEdit && (
          <SaveBar
            dirty={edit.dirty}
            overtaken={edit.overtaken}
            saving={save.isPending}
            error={save.error}
            problem={edit.dirty ? check?.(edit.value) : null}
            onSave={() =>
              save.mutate({
                ...(toSave ? toSave(edit.value) : { value: edit.value }),
                baseRevision: edit.base,
              })
            }
            onDiscard={() => {
              save.reset();
              edit.reset();
            }}
          />
        )}
      </form>
    </section>
  );
}

function StudyForm({
  value,
  set,
}: {
  value: DraftSections["study"];
  set: (value: DraftSections["study"]) => void;
}) {
  return (
    <>
      <label className={labelClass}>
        Study title
        <input
          required
          value={value.title}
          onChange={(event) => set({ ...value, title: event.target.value })}
          className={input}
        />
        <Hint>Only researchers see this.</Hint>
      </label>
      <label className={labelClass}>
        Name of the site
        <input
          required
          value={value.site.name}
          onChange={(event) => set({ ...value, site: { ...value.site, name: event.target.value } })}
          className={input}
        />
        <Hint>What participants see as the name of the platform.</Hint>
      </label>
      <Choice
        legend="What kind of platform is this?"
        value={value.platform.style}
        onChange={(style) => set({ ...value, platform: { ...value.platform, style } })}
        options={[
          {
            value: "mixed",
            label: "Mixed",
            hint: "Posts can have text, a photo, or both. Default.",
          },
          { value: "photo", label: "Photo", hint: "Like Instagram. Every post needs a photo." },
          { value: "text", label: "Text", hint: "Like X. Posts can't have photos." },
        ]}
      />
      <Choice
        legend="Light or dark?"
        value={value.platform.theme ?? "light"}
        onChange={(theme) => set({ ...value, platform: { ...value.platform, theme } })}
        options={[
          { value: "light", label: "Light", hint: "The same for everyone. Default." },
          { value: "dark", label: "Dark", hint: "The same for everyone." },
          {
            value: "device",
            label: "Whatever their device uses",
            hint: "As real platforms do, so two people in a condition may see different colors.",
          },
        ]}
      />
      <MainColor
        value={value.platform.accent}
        own={LAYOUT_ACCENTS[TEMPLATES[value.platform.template ?? DEFAULT_TEMPLATE].layout]}
        onChange={(accent) => {
          const { accent: _, ...platform } = value.platform;
          set({ ...value, platform: accent ? { ...platform, accent } : platform });
        }}
      />
      <Choice
        legend={'In an "are you sure?" box, which button is dark?'}
        value={value.platform.sureButton ?? "goBack"}
        onChange={(sureButton) => set({ ...value, platform: { ...value.platform, sureButton } })}
        options={[
          {
            value: "goBack",
            label: "Go back and edit",
            hint: "Nudges people to change what they wrote. Default.",
          },
          { value: "postAnyway", label: "Post anyway", hint: "Nudges people to post it as it is." },
        ]}
      />
      <Choice
        legend="How do comment boxes appear?"
        value={value.platform.commentBox ?? "open"}
        onChange={(commentBox) => set({ ...value, platform: { ...value.platform, commentBox } })}
        options={[
          {
            value: "open",
            label: "Always open",
            hint: "Under every post, like Facebook. Default.",
          },
          {
            value: "onReply",
            label: "After pressing Reply",
            hint: "Hidden until someone chooses to reply.",
          },
        ]}
      />
      {(value.platform.features?.spaces ??
        TEMPLATES[value.platform.template ?? DEFAULT_TEMPLATE].features.spaces) && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.platform.canJoinSpaces ?? true}
            onChange={(event) =>
              set({
                ...value,
                platform: { ...value.platform, canJoinSpaces: event.target.checked },
              })
            }
          />
          Let participants join and leave spaces{" "}
          <Hint>Off means everyone keeps the spaces they start in.</Hint>
        </label>
      )}
      <label className={labelClass}>
        The most a participant can write in a post or comment
        <input
          type="number"
          min="1"
          step="1"
          value={value.platform.maxPostLength ?? ""}
          onChange={(event) => {
            const limit = Math.trunc(Number(event.target.value));
            const { maxPostLength: _old, ...others } = value.platform;
            set({
              ...value,
              platform: limit > 0 ? { ...others, maxPostLength: limit } : others,
            });
          }}
          className={`${input} w-24`}
        />
        <Hint>Leave empty for no limit. A short posts platform might use 280.</Hint>
      </label>
      {(value.platform.features?.trending ??
        TEMPLATES[value.platform.template ?? DEFAULT_TEMPLATE].features.trending) && (
        <label className={labelClass}>
          What's trending, one on each line, as a hashtag and what it says beside it
          <textarea
            rows={3}
            aria-label="What's trending"
            defaultValue={(value.platform.trending ?? [])
              .map(({ tag, note }) => (note ? `${tag} | ${note}` : tag))
              .join("\n")}
            onChange={(event) => {
              const trending = event.target.value.split("\n").flatMap((line) => {
                const [tag = "", note = ""] = line.split("|").map((part) => part.trim());
                const name = tag.replace(/^#/, "");
                return name ? [{ tag: name, ...(note ? { note } : {}) }] : [];
              });
              set({ ...value, platform: { ...value.platform, trending } });
            }}
            placeholder={"news | 12K posts\nlocal"}
            className={input}
          />
        </label>
      )}
      {(value.platform.features?.followCounts ??
        TEMPLATES[value.platform.template ?? DEFAULT_TEMPLATE].features.followCounts) && (
        <label className={labelClass}>
          How many followers a participant starts with
          <input
            type="number"
            min="0"
            step="1"
            value={value.platform.startingFollowers ?? 0}
            onChange={(event) =>
              set({
                ...value,
                platform: {
                  ...value.platform,
                  startingFollowers: Math.max(0, Math.trunc(Number(event.target.value))),
                },
              })
            }
            className={`${input} w-24`}
          />
        </label>
      )}
      {(value.platform.features?.autoRules ??
        TEMPLATES[value.platform.template ?? DEFAULT_TEMPLATE].features.autoRules) && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.platform.recordUnpostedText ?? false}
            onChange={(event) =>
              set({
                ...value,
                platform: { ...value.platform, recordUnpostedText: event.target.checked },
              })
            }
          />
          Record what someone wrote when a rule asks if they're sure, even if they never post it
          <Hint>
            Off by default. It's text someone may choose not to share, so raise it with your IRB.
          </Hint>
        </label>
      )}
      {(value.platform.features?.karma ??
        TEMPLATES[value.platform.template ?? DEFAULT_TEMPLATE].features.karma) && (
        <label className={labelClass}>
          A participant's karma when they start
          <input
            type="number"
            step="1"
            value={value.platform.startingKarma ?? 0}
            onChange={(event) =>
              set({
                ...value,
                platform: {
                  ...value.platform,
                  startingKarma: Math.trunc(Number(event.target.value)),
                },
              })
            }
            className={`${input} w-24`}
          />
          <Hint>
            Votes on what they post add to it. Set each person in the cast's on the Cast page.
          </Hint>
        </label>
      )}
      {(value.platform.features?.karma ??
        TEMPLATES[value.platform.template ?? DEFAULT_TEMPLATE].features.karma) && (
        <KarmaChanges
          changes={value.platform.karmaChanges ?? []}
          onChange={(karmaChanges) =>
            set({ ...value, platform: { ...value.platform, karmaChanges } })
          }
        />
      )}
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">What's on this platform?</legend>
        {FEATURE_KEYS.map((key) => (
          <label key={key} className="flex items-baseline gap-2 text-sm">
            <input
              type="checkbox"
              checked={
                value.platform.features?.[key] ??
                TEMPLATES[value.platform.template ?? DEFAULT_TEMPLATE].features[key]
              }
              onChange={(event) =>
                set({
                  ...value,
                  platform: {
                    ...value.platform,
                    features: { ...value.platform.features, [key]: event.target.checked },
                  },
                })
              }
            />
            <span>
              {FEATURES[key].name} <Hint>{FEATURES[key].description}</Hint>
            </span>
          </label>
        ))}
      </fieldset>
    </>
  );
}

/** A condition being edited, remembering its saved name so a rename can follow it. */
type EditingArm = Arm & { savedAs?: string; added?: boolean };

const parseFactors = (text: string) =>
  Object.fromEntries(
    text
      .split(",")
      .map((pair) => pair.split("=").map((part) => part.trim()))
      .filter((pair): pair is [string, string] => Boolean(pair[0] && pair[1])),
  );

const showFactors = (factors: Record<string, string>) =>
  Object.entries(factors)
    .map(([factor, level]) => `${factor}=${level}`)
    .join(", ");

function FactorsField({ arm, set }: { arm: EditingArm; set: (arm: EditingArm) => void }) {
  const { text, setText } = useTextFor(arm.factors, showFactors, parseFactors);
  return (
    <label className={labelClass}>
      Factors
      <input
        value={text}
        placeholder="moderation=high, bystanders=many"
        onChange={(event) => {
          setText(event.target.value);
          set({ ...arm, factors: parseFactors(event.target.value) });
        }}
        className={input}
      />
      <Hint>Optional labels for a factorial design, so exports can split by factor.</Hint>
    </label>
  );
}

const SAME_AS_STUDY = { value: "", label: "Same as the study" };

/** A dropdown for a setting a condition may or may not change. */
function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className={labelClass}>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className={input}>
        {[SAME_AS_STUDY, ...options].map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** What makes one condition different from the rest of the study. */
function ArmDifferences({ arm, set }: { arm: EditingArm; set: (arm: EditingArm) => void }) {
  const feed: Record<string, unknown> = arm.feed ?? {};
  const platform: Record<string, unknown> = arm.platform ?? {};
  const features = arm.platform?.features ?? {};

  // Blank means the condition has no opinion, so the setting is left out rather than saved empty.
  const change = (group: "feed" | "platform", field: string, value: unknown) => {
    const { [group]: current, ...rest } = arm;
    const next = withoutUndefined({ ...(current as object), [field]: value });
    set((Object.keys(next).length > 0 ? { ...rest, [group]: next } : rest) as EditingArm);
  };
  const choice = (value: string) => (value === "" ? undefined : value);
  const yesNo = (value: string) => (value === "" ? undefined : value === "true");
  const YES_NO = [
    { value: "true", label: "Yes" },
    { value: "false", label: "No" },
  ];
  const setFeature = (key: FeatureKey, on: boolean | undefined) => {
    const next = withoutUndefined({ ...features, [key]: on });
    change("platform", "features", Object.keys(next).length > 0 ? next : undefined);
  };
  const changed =
    Object.keys(feed).length +
    Object.keys(platform).filter((field) => field !== "features").length +
    Object.keys(features).length;

  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-stone-600">
        Settings that differ in this condition{changed > 0 ? ` (${changed})` : ""}
      </summary>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Platform"
          value={(platform.style as string) ?? ""}
          options={[
            { value: "mixed", label: "Mixed" },
            { value: "photo", label: "Photo" },
            { value: "text", label: "Text" },
          ]}
          onChange={(value) => change("platform", "style", choice(value))}
        />
        <SelectField
          label="Comment boxes"
          value={(platform.commentBox as string) ?? ""}
          options={[
            { value: "open", label: "Always open" },
            { value: "onReply", label: "After pressing Reply" },
          ]}
          onChange={(value) => change("platform", "commentBox", choice(value))}
        />
        <SelectField
          label="Feed order"
          value={(feed.ranker as string) ?? ""}
          options={[
            { value: "chronological", label: "Newest first" },
            { value: "shuffle", label: "Shuffled" },
            { value: "scripted", label: "As written" },
            { value: "new", label: "New" },
            { value: "top", label: "Top, by score" },
            { value: "hot", label: "Hot" },
            { value: "best", label: "Best" },
            { value: "rising", label: "Rising" },
            { value: "controversial", label: "Controversial" },
          ]}
          onChange={(value) => change("feed", "ranker", choice(value))}
        />
        <SelectField
          label="People can choose the order"
          value={feed.participantsCanSort === undefined ? "" : String(feed.participantsCanSort)}
          options={YES_NO}
          onChange={(value) => change("feed", "participantsCanSort", yesNo(value))}
        />
        <SelectField
          label="Comment order"
          value={(feed.commentOrder as string) ?? ""}
          options={COMMENT_ORDERS.map(({ value: order, label }) => ({ value: order, label }))}
          onChange={(value) => change("feed", "commentOrder", choice(value))}
        />
        <SelectField
          label="People can choose the comment order"
          value={
            feed.participantsCanSortComments === undefined
              ? ""
              : String(feed.participantsCanSortComments)
          }
          options={YES_NO}
          onChange={(value) => change("feed", "participantsCanSortComments", yesNo(value))}
        />
        <SelectField
          label="People can join and leave spaces"
          value={platform.canJoinSpaces === undefined ? "" : String(platform.canJoinSpaces)}
          options={YES_NO}
          onChange={(value) => change("platform", "canJoinSpaces", yesNo(value))}
        />
        <OptionalNumber
          label="Feed reaches back (hours)"
          hint="Blank is the same as the study."
          value={feed.windowHours as number | undefined}
          onChange={(value) => change("feed", "windowHours", value)}
        />
        <SelectField
          label="Hide flagged content"
          value={feed.removeFlagged === undefined ? "" : String(feed.removeFlagged)}
          options={YES_NO}
          onChange={(value) => change("feed", "removeFlagged", yesNo(value))}
        />
        <SelectField
          label="Hide blocked accounts"
          value={feed.removeBlocked === undefined ? "" : String(feed.removeBlocked)}
          options={YES_NO}
          onChange={(value) => change("feed", "removeBlocked", yesNo(value))}
        />
        {FEATURE_KEYS.map((key) => (
          <SelectField
            key={key}
            label={FEATURES[key].name}
            value={features[key] === undefined ? "" : String(features[key])}
            options={[
              { value: "true", label: "On" },
              { value: "false", label: "Off" },
            ]}
            onChange={(value) => setFeature(key, yesNo(value))}
          />
        ))}
      </div>
    </details>
  );
}

function ConditionsForm({
  value,
  set: setValue,
}: {
  value: DraftSections["conditions"];
  set: (value: DraftSections["conditions"]) => void;
}) {
  // Changing the conditions keeps the shared worlds setting, which is saved with them.
  const set = (next: Pick<DraftSections["conditions"], "conditions">) =>
    setValue({ ...value, ...next });
  const { assignment, arms } = value.conditions;
  const editingArms = arms as EditingArm[];
  const totalWeight = arms.reduce((sum, arm) => sum + arm.weight, 0);

  const setArms = (next: EditingArm[]) =>
    set({ conditions: { ...value.conditions, arms: next as Arm[] } });
  const setArm = (index: number, arm: EditingArm) =>
    setArms(editingArms.map((item, i) => (i === index ? arm : item)));

  const newName = () => {
    for (let n = editingArms.length + 1; ; n += 1) {
      if (!editingArms.some(({ key }) => key === `condition-${n}`)) {
        return `condition-${n}`;
      }
    }
  };

  return (
    <>
      <Choice
        legend="How are people assigned to conditions?"
        value={assignment.method}
        onChange={(method) =>
          set({
            conditions: {
              ...value.conditions,
              assignment:
                method === "blocked" ? { method, blockSize: totalWeight } : { method: "uniform" },
            },
          })
        }
        options={[
          {
            value: "uniform",
            label: "Uniform",
            hint: "Each person is assigned at random, so counts can drift apart.",
          },
          {
            value: "blocked",
            label: "Blocked",
            hint: "Random within blocks, which keeps the counts close together.",
          },
        ]}
      />
      {assignment.method === "blocked" && (
        <label className={labelClass}>
          Block size
          <input
            type="number"
            min="1"
            step="1"
            value={assignment.blockSize}
            onChange={(event) =>
              set({
                conditions: {
                  ...value.conditions,
                  assignment: { method: "blocked", blockSize: Number(event.target.value) },
                },
              })
            }
            className={`${input} w-24`}
          />
          <Hint>
            Each block has this many people. It has to divide evenly by the total of the weights.
          </Hint>
        </label>
      )}
      <div className="space-y-3">
        <h3 className="text-sm font-medium">Conditions</h3>
        {editingArms.map((arm, index) => (
          // The position is the identity here, since the name is what's being edited.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          <div key={index} className="space-y-2 rounded border border-stone-200 p-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className={`${labelClass} min-w-40 flex-1`}>
                Name
                <input
                  required
                  value={arm.key}
                  onChange={(event) =>
                    setArm(index, {
                      ...arm,
                      key: event.target.value,
                      ...(arm.added ? {} : { savedAs: arm.savedAs ?? arm.key }),
                    })
                  }
                  className={input}
                />
              </label>
              <label className={labelClass}>
                Weight
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={arm.weight}
                  onChange={(event) =>
                    setArm(index, { ...arm, weight: Number(event.target.value) })
                  }
                  className={`${input} w-20`}
                />
              </label>
              <p className="pb-2 text-xs text-stone-500">
                {arm.weight === 0
                  ? "Only at a decision point"
                  : totalWeight > 0
                    ? `${Math.round((arm.weight / totalWeight) * 100)}% of people`
                    : ""}
              </p>
              <button
                type="button"
                disabled={editingArms.length === 1}
                onClick={() => setArms(editingArms.filter((_, i) => i !== index))}
                className={`${smallButton} mb-1`}
              >
                Remove
              </button>
            </div>
            <FactorsField arm={arm} set={(next) => setArm(index, next)} />
            <ArmDifferences arm={arm} set={(next) => setArm(index, next)} />
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setArms([...editingArms, { key: newName(), factors: {}, weight: 1, added: true }])
          }
          className={smallButton}
        >
          Add a condition
        </button>
      </div>
      <SharedWorldsField
        value={value.worlds}
        set={(worlds) => setValue(withoutUndefined({ ...value, worlds }))}
      />
    </>
  );
}

/** Whether participants share worlds, and how many to a world (ADR 67). */
function SharedWorldsField({
  value,
  set,
}: {
  value: DraftSections["conditions"]["worlds"];
  set: (value: DraftSections["conditions"]["worlds"]) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Shared worlds</legend>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value !== undefined}
          onChange={(event) => set(event.target.checked ? { size: 6, waitMinutes: 10 } : undefined)}
        />
        Put participants together, so they see each other
      </label>
      <Hint>
        Each world fills up with real participants, who all get its condition. Say so in the consent
        page, and have a moderator in the cast. See{" "}
        <a
          className="underline"
          href="https://truman-research.org/guide/shared-worlds"
          target="_blank"
          rel="noreferrer noopener"
        >
          Several real people together
        </a>
        .
      </Hint>
      {value && (
        <div className="flex flex-wrap gap-4">
          <label className={labelClass}>
            People in a world
            <input
              type="number"
              min="2"
              max="500"
              step="1"
              value={value.size}
              onChange={(event) => set({ ...value, size: Number(event.target.value) })}
              className={`${input} w-24`}
            />
          </label>
          <label className={labelClass}>
            Longest wait for others (minutes)
            <input
              type="number"
              min="0"
              max="1440"
              step="1"
              value={value.waitMinutes}
              onChange={(event) => set({ ...value, waitMinutes: Number(event.target.value) })}
              className={`${input} w-24`}
            />
          </label>
        </div>
      )}
    </fieldset>
  );
}

const conditionsToSave = (value: DraftSections["conditions"]) => {
  const arms = value.conditions.arms as EditingArm[];
  const renames = Object.fromEntries(
    arms.flatMap(({ savedAs, key }) => (savedAs && savedAs !== key ? [[savedAs, key]] : [])),
  );
  return {
    value: {
      conditions: {
        ...value.conditions,
        arms: arms.map(({ savedAs: _savedAs, added: _added, ...arm }) => arm),
      },
      ...(value.worlds ? { worlds: value.worlds } : {}),
    },
    renames,
  };
};

const checkConditions = (value: DraftSections["conditions"]) => {
  const keys = value.conditions.arms.map(({ key }) => key);
  if (keys.some((key) => !/^[a-z0-9][a-z0-9_-]*$/.test(key))) {
    return "Condition names can use lowercase letters, numbers, dashes, and underscores.";
  }
  return new Set(keys).size === keys.length ? null : "Each condition needs its own name.";
};

const parseLikes = (text: string): number[] | undefined | null => {
  const values = text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(Number);
  if (values.some((item) => !Number.isInteger(item) || item < 0)) {
    return null;
  }
  return values.length > 0 ? values : undefined;
};

/** The numbers to draw likes from. */
function LikeValues({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number[] | undefined;
  onChange: (value: number[] | undefined) => void;
}) {
  const { text, setText } = useTextFor(value, (likes) => likes?.join(", ") ?? "", parseLikes);
  return (
    <label className={labelClass}>
      {label}
      <input
        value={text}
        placeholder="1, 1, 2, 3"
        onChange={(event) => {
          setText(event.target.value);
          const parsed = parseLikes(event.target.value);
          if (parsed !== null) {
            onChange(parsed);
          }
        }}
        className={input}
      />
      <Hint>
        Each item without its own count draws one of these, so repeat a number to make it more
        likely. Blank means no likes.
      </Hint>
    </label>
  );
}

type KarmaChange = NonNullable<StudySettings["platform"]["karmaChanges"]>[number];

/** Scripted changes to karma, timed from when each participant starts. */
function KarmaChanges({
  changes,
  onChange,
}: {
  changes: KarmaChange[];
  onChange: (changes: KarmaChange[]) => void;
}) {
  const update = (index: number, change: Partial<KarmaChange>) =>
    onChange(
      changes.map((item, at) => {
        if (at !== index) {
          return item;
        }
        // A blank username is the participant, which is left out rather than saved as empty.
        const { actor, ...rest } = { ...item, ...change };
        return actor ? { actor, ...rest } : rest;
      }),
    );
  return (
    <fieldset className="space-y-2 text-sm">
      <legend className="font-medium">Scripted karma changes</legend>
      <Hint>
        Each adds or takes away points, some time after a participant starts. Leave the username
        blank for the participant. Study folders can also set these for one condition.
      </Hint>
      {changes.map((change, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity of their own
        <div key={index} className="flex flex-wrap items-center gap-2" data-testid="karma-change">
          <input
            aria-label="Username"
            placeholder="The participant"
            value={change.actor ?? ""}
            onChange={(event) => update(index, { actor: event.target.value.trim() })}
            className={`${input} w-40`}
          />
          <label className="flex items-center gap-1">
            after
            <input
              aria-label="Minutes after starting"
              type="number"
              min="0"
              step="1"
              value={change.afterMinutes}
              onChange={(event) =>
                update(index, { afterMinutes: Math.max(0, Math.trunc(Number(event.target.value))) })
              }
              className={`${input} w-20`}
            />
            minutes,
          </label>
          <label className="flex items-center gap-1">
            add
            <input
              aria-label="Points to add"
              type="number"
              step="1"
              value={change.change}
              onChange={(event) =>
                update(index, { change: Math.trunc(Number(event.target.value)) })
              }
              className={`${input} w-24`}
            />
          </label>
          <button
            type="button"
            onClick={() => onChange(changes.filter((_, at) => at !== index))}
            className="underline"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...changes, { afterMinutes: 60, change: 100 }])}
        className="rounded border border-stone-300 px-2 py-1"
      >
        Add a karma change
      </button>
    </fieldset>
  );
}

const COMMENT_ORDERS = [
  { value: "scripted", label: "As written", hint: "The time each was written for, oldest first." },
  { value: "top", label: "Top", hint: "Highest score first." },
  { value: "new", label: "New", hint: "Newest first." },
  { value: "old", label: "Old", hint: "Oldest first." },
  {
    value: "best",
    label: "Best",
    hint: "Cautious about few votes, so a few up votes don't beat many mostly-up ones.",
  },
  { value: "controversial", label: "Controversial", hint: "Many votes, split evenly, first." },
] as const;

const FEED_ORDERS = [
  { value: "chronological", label: "Newest first", hint: "Default." },
  {
    value: "shuffle",
    label: "Shuffled",
    hint: "A random order, kept the same for each person.",
  },
  { value: "scripted", label: "As written", hint: "The order the posts were written in." },
  { value: "new", label: "New", hint: "Newest first, under the name forums use." },
  {
    value: "top",
    label: "Top",
    hint: "Highest score first. The scores you wrote, plus scripted votes and the person's own.",
  },
  { value: "hot", label: "Hot", hint: "High scores and recent posts first, falling with age." },
  {
    value: "best",
    label: "Best",
    hint: "Cautious about few votes, so a few up votes don't beat many mostly-up ones.",
  },
  { value: "rising", label: "Rising", hint: "The last day's posts first, by score per hour." },
  { value: "controversial", label: "Controversial", hint: "Many votes, split evenly, first." },
] as const;

function FeedForm({
  value,
  set,
  spacesOn,
  defaultCommentOrder,
  followingFeedOn,
  adsOn,
}: {
  value: DraftSections["feed"];
  set: (value: DraftSections["feed"]) => void;
  /** Whether any condition has spaces, so whether a space's own order means anything. */
  spacesOn: boolean;
  /** Whether any condition has a following feed. */
  followingFeedOn: boolean;
  /** Whether any condition has ads. */
  adsOn: boolean;
  /** The comment order a study has until it chooses one, from its template. */
  defaultCommentOrder: (typeof COMMENT_ORDERS)[number]["value"];
}) {
  const { feed, likes, length } = value;
  const setFeed = (changes: Partial<typeof feed>) =>
    set({ ...value, feed: withoutUndefined({ ...feed, ...changes }) });

  return (
    <>
      <label className={labelClass}>
        How long is the study? (days)
        <input
          type="number"
          min="0"
          step="any"
          value={length.days}
          onChange={(event) => set({ ...value, length: { days: Number(event.target.value) } })}
          className={`${input} w-24`}
        />
      </label>
      <Choice
        legend="What order is the feed in?"
        value={feed.ranker}
        onChange={(ranker) => setFeed({ ranker })}
        options={[...FEED_ORDERS]}
      />
      {spacesOn && (
        <SelectField
          label="Order on a space's page"
          value={feed.spaceRanker ?? ""}
          options={FEED_ORDERS.map(({ value: order, label }) => ({ value: order, label }))}
          onChange={(order) =>
            setFeed({
              spaceRanker: (order || undefined) as typeof feed.spaceRanker,
            } as Partial<typeof feed>)
          }
        />
      )}
      {followingFeedOn && (
        <>
          <SelectField
            label="Order on the following tab"
            value={feed.followingRanker ?? ""}
            options={FEED_ORDERS.map(({ value: order, label }) => ({ value: order, label }))}
            onChange={(order) =>
              setFeed({
                followingRanker: (order || undefined) as typeof feed.followingRanker,
              } as Partial<typeof feed>)
            }
          />
          <label className={labelClass}>
            What the main tab is called
            <input
              value={feed.homeTabLabel ?? ""}
              maxLength={30}
              placeholder="For you"
              onChange={(event) =>
                setFeed({ homeTabLabel: event.target.value || undefined } as Partial<typeof feed>)
              }
              className={`${input} w-48`}
            />
          </label>
          <label className={labelClass}>
            What the following tab is called
            <input
              value={feed.followingTabLabel ?? ""}
              maxLength={30}
              placeholder="Following"
              onChange={(event) =>
                setFeed({
                  followingTabLabel: event.target.value || undefined,
                } as Partial<typeof feed>)
              }
              className={`${input} w-48`}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={feed.startOnFollowing ?? false}
              onChange={(event) =>
                setFeed({ startOnFollowing: event.target.checked || undefined } as Partial<
                  typeof feed
                >)
              }
            />
            People start on the following tab
          </label>
        </>
      )}
      {adsOn && (
        <label className={labelClass}>
          Show an ad after every this many posts
          <input
            type="number"
            min="1"
            step="1"
            value={feed.adEvery ?? ""}
            onChange={(event) => {
              const every = Math.trunc(Number(event.target.value));
              setFeed({ adEvery: every > 0 ? every : undefined } as Partial<typeof feed>);
            }}
            className={`${input} w-24`}
          />
          <Hint>Leave empty to order ads like any other post.</Hint>
        </label>
      )}
      <Choice
        legend="What order are comments in?"
        value={feed.commentOrder ?? defaultCommentOrder}
        onChange={(commentOrder) => setFeed({ commentOrder })}
        options={[...COMMENT_ORDERS]}
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={feed.participantsCanSortComments ?? false}
          onChange={(event) =>
            setFeed({ participantsCanSortComments: event.target.checked || undefined } as Partial<
              typeof feed
            >)
          }
        />
        Let people pick how comments are sorted{" "}
        <Hint>Off by default, and each change is recorded.</Hint>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={feed.participantsCanSort ?? false}
          onChange={(event) =>
            setFeed({ participantsCanSort: event.target.checked || undefined } as Partial<
              typeof feed
            >)
          }
        />
        Let participants choose the order <Hint>Off by default, and each change is recorded.</Hint>
      </label>
      {feed.ranker === "shuffle" && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={feed.reshuffleEachVisit}
            onChange={(event) => setFeed({ reshuffleEachVisit: event.target.checked })}
          />
          A new order on every visit
        </label>
      )}
      <OptionalNumber
        label="How far back the feed reaches (hours)"
        hint="Blank means no limit. Default."
        value={feed.windowHours}
        onChange={(windowHours) => setFeed({ windowHours } as Partial<typeof feed>)}
      />
      <OptionalNumber
        label="Keep someone's new post on top (minutes)"
        hint="Blank means it isn't pinned. Default."
        value={feed.pinOwnPostsMinutes}
        onChange={(pinOwnPostsMinutes) => setFeed({ pinOwnPostsMinutes } as Partial<typeof feed>)}
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={feed.removeFlagged}
          onChange={(event) => setFeed({ removeFlagged: event.target.checked })}
        />
        Hide content someone has flagged <Hint>Off by default.</Hint>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={feed.removeBlocked}
          onChange={(event) => setFeed({ removeBlocked: event.target.checked })}
        />
        Hide accounts someone has blocked <Hint>Off by default.</Hint>
      </label>
      <LikeValues
        label="Likes on posts"
        value={likes.posts}
        onChange={(posts) =>
          set({ ...value, likes: withoutUndefined({ ...likes, posts }) as typeof likes })
        }
      />
      <LikeValues
        label="Likes on comments"
        value={likes.comments}
        onChange={(comments) =>
          set({ ...value, likes: withoutUndefined({ ...likes, comments }) as typeof likes })
        }
      />
    </>
  );
}

/** The text of a consent or other page, saved on its own. */
function PageEditor({
  draftId,
  pageKey,
  page,
  canEdit,
  others,
  onFocus,
}: {
  draftId: string;
  pageKey: string;
  page: { revision: number; text: string } | undefined;
  canEdit: boolean;
  others: Others;
  onFocus: (section: string) => void;
}) {
  const section = `page:${pageKey}`;
  const edit = useEdit({ revision: page?.revision ?? 0, value: page?.text ?? "" });
  const save = useSaver(draftId, section, edit.reset);
  const [previewing, setPreviewing] = useState(false);
  const editors = others.filter((person) => person.section === section);

  return (
    <div className="space-y-2" onFocusCapture={() => onFocus(section)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Page text</span>
        <button type="button" onClick={() => setPreviewing(!previewing)} className={smallButton}>
          {previewing ? "Edit the text" : "See it as participants will"}
        </button>
      </div>
      {editors.length > 0 && (
        <p className="inline-block rounded bg-sky-100 px-2 py-0.5 text-xs text-sky-900">
          {editors.map((person) => person.name).join(", ")} editing this
        </p>
      )}
      {previewing ? (
        <div className="prose-page rounded border border-stone-200 p-3 text-sm">
          <Markdown>{edit.value}</Markdown>
        </div>
      ) : (
        <>
          <textarea
            aria-label="Page text"
            rows={8}
            disabled={!canEdit || save.isPending}
            value={edit.value}
            onChange={(event) => edit.set(event.target.value)}
            className={`${input} w-full font-mono`}
          />
          <Hint># makes a heading, and **bold** makes bold text.</Hint>
        </>
      )}
      {canEdit && (edit.dirty || edit.overtaken) && (
        <SaveBar
          dirty={edit.dirty}
          overtaken={edit.overtaken}
          saving={save.isPending}
          error={save.error}
          onSave={() => save.mutate({ value: edit.value, baseRevision: edit.base })}
          onDiscard={() => {
            save.reset();
            edit.reset();
          }}
        />
      )}
    </div>
  );
}

const STEP_NAMES: Record<Step["step"], string> = {
  consent: "Consent",
  account: "Create a profile",
  page: "A page of text",
  feed: "The feed",
  exit: "Exit",
};

/** Opens a link the way a participant's would be, so it can be tried before anyone relies on it. */
function LinkField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <div className="space-y-1">
      <label className={labelClass}>
        {label}
        <input
          type="url"
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value.trim() || undefined)}
          placeholder="https://"
          className={input}
        />
        <Hint>{hint}</Hint>
      </label>
      {value && (
        <a
          href={fillLinkTemplate(value, {
            externalId: "TEST_ID",
            participantId: "TEST_PARTICIPANT",
          })}
          target="_blank"
          rel="noreferrer"
          className="text-xs underline"
        >
          Try this link with a test ID
        </a>
      )}
    </div>
  );
}

function FlowForm({
  draftId,
  value,
  set,
  settings,
  others,
  onFocus,
}: {
  draftId: string;
  value: DraftSections["flow"];
  set: (value: DraftSections["flow"]) => void;
  settings: DraftSettings;
  others: Others;
  onFocus: (section: string) => void;
}) {
  const client = useQueryClient();
  const { flow, entry } = value;
  const setFlow = (next: Step[]) => set({ ...value, flow: next });
  const setStep = (index: number, step: Step) =>
    setFlow(flow.map((item, i) => (i === index ? step : item)));

  // A page has to exist before a step can point at it, so it's written first.
  const addPage = useMutation({
    mutationFn: async (kind: "consent" | "page") => {
      const page = `pages/${kind}-${crypto.randomUUID().slice(0, 8)}.md`;
      await send("PUT", `/admin/drafts/${draftId}/settings`, {
        section: `page:${page}`,
        value: kind === "consent" ? "# Consent\n\nDescribe the study here." : "# A new page",
        baseRevision: 0,
      });
      await client.invalidateQueries({ queryKey: ["draft", draftId] });
      return { kind, page };
    },
    onSuccess: ({ kind, page }) => {
      const step: Step = { step: kind, page };
      const exit = flow.findIndex((item) => item.step === "exit");
      const at = kind === "consent" ? 0 : exit === -1 ? flow.length : exit;
      setFlow([...flow.slice(0, at), step, ...flow.slice(at)]);
    },
  });

  const move = (index: number, by: number) => {
    const next = [...flow];
    const [step] = next.splice(index, 1);
    next.splice(index + by, 0, step as Step);
    setFlow(next);
  };

  const add = (kind: Step["step"]) => {
    if (kind === "consent" || kind === "page") {
      addPage.mutate(kind);
    } else if (kind === "exit") {
      setFlow([...flow, { step: "exit" }]);
    } else {
      const step: Step = kind === "feed" ? { step: "feed" } : { step: "account" };
      const exit = flow.findIndex((item) => item.step === "exit");
      const at = exit === -1 ? flow.length : exit;
      setFlow([...flow.slice(0, at), step, ...flow.slice(at)]);
    }
  };

  const has = (kind: Step["step"]) => flow.some(({ step }) => step === kind);
  const canAdd = (["consent", "account", "page", "feed", "exit"] as const).filter(
    (kind) => kind === "page" || !has(kind),
  );

  return (
    <>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">What participants go through, in order</h3>
        <ol className="space-y-2">
          {flow.map((step, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: steps have no identity beyond their place
            <li key={index} className="space-y-3 rounded border border-stone-200 p-3">
              <div className="flex items-center gap-2">
                <span className="mr-auto text-sm font-medium">
                  {index + 1}. {STEP_NAMES[step.step]}
                </span>
                <button
                  type="button"
                  aria-label={`Move ${STEP_NAMES[step.step]} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  className={smallButton}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${STEP_NAMES[step.step]} down`}
                  disabled={index === flow.length - 1}
                  onClick={() => move(index, 1)}
                  className={smallButton}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${STEP_NAMES[step.step]}`}
                  onClick={() => setFlow(flow.filter((_, i) => i !== index))}
                  className={smallButton}
                >
                  Remove
                </button>
              </div>

              {(step.step === "consent" || step.step === "page") && (
                <PageEditor
                  draftId={draftId}
                  pageKey={step.page}
                  page={settings.pages[step.page]}
                  canEdit={settings.canEdit}
                  others={others}
                  onFocus={onFocus}
                />
              )}
              {step.step === "consent" && (
                <>
                  <label className={labelClass}>
                    What someone sees after declining
                    <textarea
                      rows={2}
                      value={step.declineMessage ?? ""}
                      onChange={(event) =>
                        setStep(
                          index,
                          withoutUndefined({
                            ...step,
                            declineMessage: event.target.value || undefined,
                          }) as Step,
                        )
                      }
                      className={input}
                    />
                    <Hint>On Prolific, this should say to return their submission.</Hint>
                  </label>
                  <LinkField
                    label="Or send them to a link after declining"
                    hint="This replaces the message."
                    value={step.declineRedirect}
                    onChange={(declineRedirect) =>
                      setStep(index, withoutUndefined({ ...step, declineRedirect }) as Step)
                    }
                  />
                </>
              )}
              {step.step === "feed" && (
                <OptionalNumber
                  label="When someone may choose to finish (minutes)"
                  hint="Blank keeps them here until the study ends."
                  value={step.finishAfterMinutes}
                  onChange={(finishAfterMinutes) =>
                    setStep(index, withoutUndefined({ ...step, finishAfterMinutes }) as Step)
                  }
                />
              )}
              {step.step === "exit" && (
                <LinkField
                  label="Where to send them at the end"
                  hint="Usually your exit survey. {externalId} fills in their recruitment ID."
                  value={step.redirect}
                  onChange={(redirect) =>
                    setStep(index, withoutUndefined({ ...step, redirect }) as Step)
                  }
                />
              )}
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-stone-500">Add:</span>
          {canAdd.map((kind) => (
            <button
              key={kind}
              type="button"
              disabled={addPage.isPending}
              onClick={() => add(kind)}
              className={smallButton}
            >
              {STEP_NAMES[kind]}
            </button>
          ))}
        </div>
        {addPage.error && (
          <p role="alert" className="text-sm text-rose-700">
            {addPage.error.message}
          </p>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium">How people arrive</h3>
        <label className={labelClass}>
          The link's name for their recruitment ID
          <input
            required
            value={entry.idParam}
            onChange={(event) =>
              set({ ...value, entry: { ...entry, idParam: event.target.value } })
            }
            className={input}
          />
          <Hint>
            On Prolific, this is PROLIFIC_PID. Your study link is /join/{settings.slug}?
            {entry.idParam}=their ID.
          </Hint>
        </label>
        <label className={labelClass}>
          What to call it, if someone has to type it
          <input
            required
            value={entry.idLabel}
            onChange={(event) =>
              set({ ...value, entry: { ...entry, idLabel: event.target.value } })
            }
            className={input}
          />
        </label>
        <label className={labelClass}>
          Where people are recruited from
          <input
            required
            value={entry.source}
            onChange={(event) => set({ ...value, entry: { ...entry, source: event.target.value } })}
            className={input}
          />
          <Hint>Recorded with each participant, such as "prolific".</Hint>
        </label>
      </div>
    </>
  );
}

const WARNINGS_SHOWN = 5;

export function SettingsPage() {
  const { draftId } = useParams({ from: "/drafts/$draftId/settings" });
  const settings = useQuery({
    queryKey: ["draft", draftId, "settings"],
    queryFn: () => get<DraftSettings>(`/admin/drafts/${draftId}/settings`),
  });
  const [section, setSection] = useState<string | null>(null);
  const others = useDraftPresence(draftId, null, section);

  if (!settings.data) {
    return null;
  }
  const data = settings.data;
  const errors = data.issues.filter(({ severity }) => severity === "error");
  const warnings = data.issues.filter(({ severity }) => severity === "warning");
  const shared = { draftId, settings: data, others, onFocus: setSection };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/drafts/$draftId" params={{ draftId }} className="text-sm underline">
          Back to the feed
        </Link>
        <h1 className="text-lg font-semibold">
          Settings for {data.title} <span className="font-normal text-amber-700">draft</span>
        </h1>
      </div>
      <p className="text-sm text-stone-500">
        Saving here changes the draft. Participants get these once you save the draft as a version
        and launch it.
      </p>
      {others.length > 0 && (
        <p className="text-xs" data-testid="also-here">
          <span className="rounded bg-sky-100 px-2 py-0.5 text-sky-900">
            Also here: {others.map(({ name }) => name).join(", ")}
          </span>
        </p>
      )}
      {errors.length > 0 && (
        <ul aria-label="Problems to fix before saving a version" className="space-y-1 text-sm">
          {errors.map(({ message }) => (
            <li key={message} className="rounded bg-rose-50 p-2 text-rose-800">
              {message}
            </li>
          ))}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul aria-label="Things to check" className="space-y-1 text-sm">
          {warnings.slice(0, WARNINGS_SHOWN).map(({ message }) => (
            <li key={message} className="rounded bg-amber-50 p-2 text-amber-900">
              {message}
            </li>
          ))}
          {warnings.length > WARNINGS_SHOWN && (
            <li className="p-2 text-stone-500">And {warnings.length - WARNINGS_SHOWN} more.</li>
          )}
        </ul>
      )}

      <Section
        {...shared}
        name="study"
        title="Study and platform"
        intro="What this platform is like."
      >
        {(value, set) => <StudyForm value={value} set={set} />}
      </Section>
      <Section
        {...shared}
        name="conditions"
        title="Conditions"
        intro="Who gets what. Renaming a condition keeps the posts and comments limited to it."
        check={checkConditions}
        toSave={conditionsToSave}
      >
        {(value, set) => <ConditionsForm value={value} set={set} />}
      </Section>
      <Section {...shared} name="feed" title="Feed" intro="How the feed behaves for everyone.">
        {(value, set) => (
          <FeedForm
            value={value}
            set={set}
            defaultCommentOrder={
              (
                TEMPLATES[
                  data.sections.study.value.platform.template ?? DEFAULT_TEMPLATE
                ] as TemplateDefinition
              ).feed?.commentOrder ?? "scripted"
            }
            adsOn={[
              data.sections.study.value.platform.features?.ads ??
                TEMPLATES[data.sections.study.value.platform.template ?? DEFAULT_TEMPLATE].features
                  .ads,
              ...data.sections.conditions.value.conditions.arms.map(
                (arm) => arm.platform?.features?.ads,
              ),
            ].includes(true)}
            followingFeedOn={[
              data.sections.study.value.platform.features?.followingFeed ??
                TEMPLATES[data.sections.study.value.platform.template ?? DEFAULT_TEMPLATE].features
                  .followingFeed,
              ...data.sections.conditions.value.conditions.arms.map(
                (arm) => arm.platform?.features?.followingFeed,
              ),
            ].includes(true)}
            spacesOn={[
              data.sections.study.value.platform.features?.spaces ??
                TEMPLATES[data.sections.study.value.platform.template ?? DEFAULT_TEMPLATE].features
                  .spaces,
              ...data.sections.conditions.value.conditions.arms.map(
                (arm) => arm.platform?.features?.spaces,
              ),
            ].includes(true)}
          />
        )}
      </Section>
      <Section
        {...shared}
        name="flow"
        title="Study flow"
        intro="The steps from arriving to finishing."
      >
        {(value, set) => (
          <FlowForm
            draftId={draftId}
            value={value}
            set={set}
            settings={data}
            others={others}
            onFocus={setSection}
          />
        )}
      </Section>

      <RecentChanges draftId={draftId} canEdit={data.canEdit} />
    </div>
  );
}
