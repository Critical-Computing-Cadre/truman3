import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { formatStudyTime, parseStudyTime, ruleMatches } from "@truman3/core";
import { useState } from "react";
import { type DraftInfo, get } from "../api.ts";
import { SavedCheckbox } from "../components/SavedCheckbox.tsx";
import { CastField } from "./CastPage.tsx";
import { type DraftEdits, SaveStatus, useDraftEdits, useDraftPresence } from "./DraftPage.tsx";

const LABEL = "flex flex-col gap-1 text-xs font-medium text-stone-600";
const INPUT = "rounded border border-stone-300 px-2 py-1 text-sm font-normal text-stone-900";

/** The cast, with moderators first, since they're who a study usually means. */
function ModeratorPicker({
  actors,
  value,
  canEdit,
  onChange,
}: {
  actors: DraftInfo["actors"];
  value: string;
  canEdit: boolean;
  onChange: (actorId: string) => void;
}) {
  const ordered = [...actors].sort((a, b) => Number(b.moderator) - Number(a.moderator));
  return (
    <label className={LABEL}>
      Moderator
      <select
        disabled={!canEdit}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={INPUT}
      >
        {ordered.map((actor) => (
          <option key={actor.id} value={actor.id}>
            {actor.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A time typed as hours:minutes. It saves when it's left, if it can be read. */
function TimeField({
  label,
  help,
  valueMs,
  canEdit,
  allowBefore,
  onSave,
}: {
  label: string;
  help: string;
  valueMs: number;
  canEdit: boolean;
  /** Whether it can be before someone starts. */
  allowBefore: boolean;
  onSave: (ms: number) => void;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const [problem, setProblem] = useState(false);
  const finish = () => {
    if (typed === null) {
      return;
    }
    const parsed = parseStudyTime(typed);
    if (parsed === null || (!allowBefore && parsed < 0)) {
      setProblem(true);
      return;
    }
    setProblem(false);
    setTyped(null);
    if (parsed !== valueMs) {
      onSave(parsed);
    }
  };
  return (
    <label className={LABEL}>
      {label}
      <input
        disabled={!canEdit}
        value={typed ?? formatStudyTime(valueMs)}
        aria-invalid={problem}
        onChange={(event) => setTyped(event.target.value)}
        onBlur={finish}
        className={INPUT}
      />
      <span className={`font-normal ${problem ? "text-rose-700" : "text-stone-500"}`}>
        {problem ? "Use hours:minutes, like 2:05" : help}
      </span>
    </label>
  );
}

function ConditionChoices({
  all,
  chosen,
  canEdit,
  onChange,
}: {
  all: string[];
  chosen: string[];
  canEdit: boolean;
  onChange: (conditions: string[]) => void;
}) {
  if (all.length < 2) {
    return null;
  }
  return (
    <fieldset className="text-xs">
      <legend className="font-medium text-stone-600">Only in these conditions (none is all)</legend>
      <div className="mt-1 flex flex-wrap gap-3">
        {all.map((key) => (
          <SavedCheckbox
            key={key}
            checked={chosen.includes(key)}
            disabled={!canEdit}
            className="flex items-center gap-1"
            onChange={(on) =>
              onChange(on ? [...chosen, key] : chosen.filter((item) => item !== key))
            }
          >
            {key}
          </SavedCheckbox>
        ))}
      </div>
    </fieldset>
  );
}

const shorten = (text: string) => (text.length > 60 ? `${text.slice(0, 60)}...` : text);

function RemovalCard({
  removal,
  info,
  edits,
}: {
  removal: DraftInfo["removals"][number];
  info: DraftInfo;
  edits: DraftEdits;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const save = (changes: object) => {
    setProblem(null);
    edits.update.mutate(
      { itemId: removal.id, changes },
      { onError: (error) => setProblem(error.message) },
    );
  };
  const value = `${removal.on}:${removal.targetId}`;
  return (
    <li aria-label="Removal" className="space-y-2 rounded-lg bg-white p-3 shadow-sm">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={`${LABEL} sm:col-span-2`}>
          What it removes
          <select
            disabled={!info.canEdit}
            value={value}
            onChange={(event) => {
              const [on, targetId] = event.target.value.split(":");
              save({ on, targetId });
            }}
            className={INPUT}
          >
            <optgroup label="Posts">
              {info.posts.map((post) => (
                <option key={post.id} value={`post:${post.id}`}>
                  {post.authorName}: {shorten(post.title ?? post.body) || "(no text)"}
                </option>
              ))}
            </optgroup>
            <optgroup label="Comments">
              {info.comments.map((comment) => (
                <option key={comment.id} value={`comment:${comment.id}`}>
                  {comment.authorName}: {shorten(comment.body)}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <ModeratorPicker
          actors={info.actors}
          value={removal.actorId}
          canEdit={info.canEdit}
          onChange={(actorId) => save({ actorId })}
        />
        <TimeField
          label="When"
          help="hours:minutes from when they start"
          valueMs={removal.timeMs}
          canEdit={info.canEdit}
          allowBefore
          onSave={(timeMs) => save({ timeMs })}
        />
      </div>
      <CastField
        label="Reason shown (optional)"
        value={removal.reason}
        canEdit={info.canEdit}
        multiline
        onSave={(reason) => save({ reason: reason || null })}
      />
      <ConditionChoices
        all={info.conditions.map(({ key }) => key)}
        chosen={removal.conditions}
        canEdit={info.canEdit}
        onChange={(conditions) => save({ conditions })}
      />
      {problem && (
        <p role="alert" className="text-sm text-rose-700">
          {problem}
        </p>
      )}
      {info.canEdit && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => edits.remove.mutate(removal.id)}
            className="rounded border border-stone-300 px-2 py-1 text-xs"
          >
            Delete this removal
          </button>
        </div>
      )}
    </li>
  );
}

function ReactionCard({
  reaction,
  info,
  edits,
}: {
  reaction: DraftInfo["moderatorReactions"][number];
  info: DraftInfo;
  edits: DraftEdits;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const save = (changes: object) => {
    setProblem(null);
    edits.update.mutate(
      { itemId: reaction.id, changes },
      { onError: (error) => setProblem(error.message) },
    );
  };
  return (
    <li aria-label="Response" className="space-y-2 rounded-lg bg-white p-3 shadow-sm">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={LABEL}>
          What happens
          <select
            disabled={!info.canEdit}
            value={reaction.type}
            onChange={(event) => save({ type: event.target.value })}
            className={INPUT}
          >
            <option value="remove">Remove it</option>
            <option value="warn">Warn them</option>
          </select>
        </label>
        <ModeratorPicker
          actors={info.actors}
          value={reaction.actorId}
          canEdit={info.canEdit}
          onChange={(actorId) => save({ actorId })}
        />
        <label className={LABEL}>
          Which one they write
          <span className="flex gap-2">
            <input
              type="number"
              min={1}
              aria-label="Which number"
              disabled={!info.canEdit}
              value={reaction.nth + 1}
              onChange={(event) => {
                const number = Number.parseInt(event.target.value, 10);
                if (number >= 1) {
                  save({ nth: number - 1 });
                }
              }}
              className={`${INPUT} w-20`}
            />
            <select
              aria-label="Post or comment"
              disabled={!info.canEdit}
              value={reaction.on}
              onChange={(event) => save({ on: event.target.value })}
              className={INPUT}
            >
              <option value="post">post</option>
              <option value="comment">comment</option>
            </select>
          </span>
        </label>
        <TimeField
          label="How long after"
          help="hours:minutes after they write it"
          valueMs={reaction.afterMs}
          canEdit={info.canEdit}
          allowBefore={false}
          onSave={(afterMs) => save({ afterMs })}
        />
      </div>
      <CastField
        label={reaction.type === "warn" ? "What the warning says" : "Reason shown (optional)"}
        value={reaction.body}
        canEdit={info.canEdit}
        required={reaction.type === "warn"}
        multiline
        onSave={(body) => save({ body: body || null })}
      />
      <ConditionChoices
        all={info.conditions.map(({ key }) => key)}
        chosen={reaction.conditions}
        canEdit={info.canEdit}
        onChange={(conditions) => save({ conditions })}
      />
      {problem && (
        <p role="alert" className="text-sm text-rose-700">
          {problem}
        </p>
      )}
      {info.canEdit && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => edits.remove.mutate(reaction.id)}
            className="rounded border border-stone-300 px-2 py-1 text-xs"
          >
            Delete this response
          </button>
        </div>
      )}
    </li>
  );
}

function FlagAnswerCard({
  answer,
  info,
  edits,
}: {
  answer: DraftInfo["flagAnswers"][number];
  info: DraftInfo;
  edits: DraftEdits;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const save = (changes: object) => {
    setProblem(null);
    edits.update.mutate(
      { itemId: answer.id, changes },
      { onError: (error) => setProblem(error.message) },
    );
  };
  return (
    <li aria-label="Answer to a flag" className="space-y-2 rounded-lg bg-white p-3 shadow-sm">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={`${LABEL} sm:col-span-2`}>
          When someone flags
          <select
            disabled={!info.canEdit}
            value={answer.targetId ? `${answer.on}:${answer.targetId}` : "any"}
            onChange={(event) => {
              const [on, targetId] = event.target.value.split(":");
              save(targetId ? { on, targetId } : { on: null, targetId: null });
            }}
            className={INPUT}
          >
            <option value="any">Anything without its own answer here</option>
            <optgroup label="Posts">
              {info.posts.map((post) => (
                <option key={post.id} value={`post:${post.id}`}>
                  {post.authorName}: {shorten(post.title ?? post.body) || "(no text)"}
                </option>
              ))}
            </optgroup>
            <optgroup label="Comments">
              {info.comments.map((comment) => (
                <option key={comment.id} value={`comment:${comment.id}`}>
                  {comment.authorName}: {shorten(comment.body)}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label className={LABEL}>
          What happens
          <select
            disabled={!info.canEdit}
            value={answer.action}
            onChange={(event) => save({ action: event.target.value })}
            className={INPUT}
          >
            <option value="answer">Answer with a message</option>
            <option value="remove">Remove it</option>
          </select>
        </label>
        <ModeratorPicker
          actors={info.actors}
          value={answer.actorId}
          canEdit={info.canEdit}
          onChange={(actorId) => save({ actorId })}
        />
        <TimeField
          label="How long after"
          help="hours:minutes after they flag it"
          valueMs={answer.afterMs}
          canEdit={info.canEdit}
          allowBefore={false}
          onSave={(afterMs) => save({ afterMs })}
        />
      </div>
      <CastField
        label={answer.action === "answer" ? "What the answer says" : "Reason shown (optional)"}
        value={answer.message}
        canEdit={info.canEdit}
        required={answer.action === "answer"}
        multiline
        onSave={(message) => save({ message: message || null })}
      />
      <ConditionChoices
        all={info.conditions.map(({ key }) => key)}
        chosen={answer.conditions}
        canEdit={info.canEdit}
        onChange={(conditions) => save({ conditions })}
      />
      {problem && (
        <p role="alert" className="text-sm text-rose-700">
          {problem}
        </p>
      )}
      {info.canEdit && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => edits.remove.mutate(answer.id)}
            className="rounded border border-stone-300 px-2 py-1 text-xs"
          >
            Delete this answer
          </button>
        </div>
      )}
    </li>
  );
}

function BanCard({
  ban,
  info,
  edits,
}: {
  ban: DraftInfo["bans"][number];
  info: DraftInfo;
  edits: DraftEdits;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const save = (changes: object) => {
    setProblem(null);
    edits.update.mutate(
      { itemId: ban.id, changes },
      { onError: (error) => setProblem(error.message) },
    );
  };
  return (
    <li aria-label="Ban" className="space-y-2 rounded-lg bg-white p-3 shadow-sm">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={LABEL}>
          Who's banned
          <select
            disabled={!info.canEdit}
            value={ban.bannedActorId}
            onChange={(event) => save({ bannedActorId: event.target.value })}
            className={INPUT}
          >
            {info.actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.name}
              </option>
            ))}
          </select>
        </label>
        <ModeratorPicker
          actors={info.actors}
          value={ban.actorId}
          canEdit={info.canEdit}
          onChange={(actorId) => save({ actorId })}
        />
        <TimeField
          label="When"
          help="hours:minutes from when they start"
          valueMs={ban.timeMs}
          canEdit={info.canEdit}
          allowBefore
          onSave={(timeMs) => save({ timeMs })}
        />
        {info.spaces.length > 0 && (
          <label className={LABEL}>
            From
            <select
              disabled={!info.canEdit}
              value={ban.spaceId ?? ""}
              onChange={(event) => save({ spaceId: event.target.value || null })}
              className={INPUT}
            >
              <option value="">Everywhere</option>
              {info.spaces.map((space) => (
                <option key={space.id} value={space.id}>
                  {space.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <CastField
        label="Reason shown (optional)"
        value={ban.reason}
        canEdit={info.canEdit}
        multiline
        onSave={(reason) => save({ reason: reason || null })}
      />
      <ConditionChoices
        all={info.conditions.map(({ key }) => key)}
        chosen={ban.conditions}
        canEdit={info.canEdit}
        onChange={(conditions) => save({ conditions })}
      />
      {problem && (
        <p role="alert" className="text-sm text-rose-700">
          {problem}
        </p>
      )}
      {info.canEdit && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => edits.remove.mutate(ban.id)}
            className="rounded border border-stone-300 px-2 py-1 text-xs"
          >
            Delete this ban
          </button>
        </div>
      )}
    </li>
  );
}

function ReportAnswerCard({
  answer,
  info,
  edits,
}: {
  answer: DraftInfo["reportAnswers"][number];
  info: DraftInfo;
  edits: DraftEdits;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const save = (changes: object) => {
    setProblem(null);
    edits.update.mutate(
      { itemId: answer.id, changes },
      { onError: (error) => setProblem(error.message) },
    );
  };
  return (
    <li aria-label="Answer to a report" className="space-y-2 rounded-lg bg-white p-3 shadow-sm">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={LABEL}>
          When someone reports
          <select
            disabled={!info.canEdit}
            value={answer.reportedActorId ?? ""}
            onChange={(event) => save({ reportedActorId: event.target.value || null })}
            className={INPUT}
          >
            <option value="">Anyone without their own answer here</option>
            {info.actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.name}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          What happens
          <select
            disabled={!info.canEdit}
            value={answer.action}
            onChange={(event) => save({ action: event.target.value })}
            className={INPUT}
          >
            <option value="answer">Answer with a message</option>
            <option value="ban">Ban them</option>
          </select>
        </label>
        <ModeratorPicker
          actors={info.actors}
          value={answer.actorId}
          canEdit={info.canEdit}
          onChange={(actorId) => save({ actorId })}
        />
        <TimeField
          label="How long after"
          help="hours:minutes after they report"
          valueMs={answer.afterMs}
          canEdit={info.canEdit}
          allowBefore={false}
          onSave={(afterMs) => save({ afterMs })}
        />
      </div>
      <CastField
        label={answer.action === "answer" ? "What the answer says" : "Reason shown (optional)"}
        value={answer.message}
        canEdit={info.canEdit}
        required={answer.action === "answer"}
        multiline
        onSave={(message) => save({ message: message || null })}
      />
      <ConditionChoices
        all={info.conditions.map(({ key }) => key)}
        chosen={answer.conditions}
        canEdit={info.canEdit}
        onChange={(conditions) => save({ conditions })}
      />
      {problem && (
        <p role="alert" className="text-sm text-rose-700">
          {problem}
        </p>
      )}
      {info.canEdit && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => edits.remove.mutate(answer.id)}
            className="rounded border border-stone-300 px-2 py-1 text-xs"
          >
            Delete this answer
          </button>
        </div>
      )}
    </li>
  );
}

function AutoRuleCard({
  rule,
  info,
  edits,
}: {
  rule: DraftInfo["autoRules"][number];
  info: DraftInfo;
  edits: DraftEdits;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [trying, setTrying] = useState("");
  const save = (changes: object) => {
    setProblem(null);
    edits.update.mutate(
      { itemId: rule.id, changes },
      { onError: (error) => setProblem(error.message) },
    );
  };
  const speaks = rule.action === "confirm" || rule.action === "warn";
  return (
    <li aria-label="Automatic rule" className="space-y-2 rounded-lg bg-white p-3 shadow-sm">
      <CastField
        label="Words to look for, separated by | (end one with * for the start of a word)"
        value={rule.match}
        canEdit={info.canEdit}
        required
        onSave={(match) => save({ match })}
      />
      <label className={LABEL}>
        Try it on a sentence
        <input
          value={trying}
          onChange={(event) => setTrying(event.target.value)}
          className={INPUT}
        />
        {trying && (
          <span
            data-testid="rule-try"
            className={`font-normal ${ruleMatches(rule.match, trying) ? "text-rose-700" : "text-stone-500"}`}
          >
            {ruleMatches(rule.match, trying)
              ? "This rule catches that."
              : "This rule doesn't catch that."}
          </span>
        )}
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={LABEL}>
          Looks at
          <select
            disabled={!info.canEdit}
            value={rule.on}
            onChange={(event) => save({ on: event.target.value })}
            className={INPUT}
          >
            <option value="both">Posts and comments</option>
            <option value="post">Posts</option>
            <option value="comment">Comments</option>
          </select>
        </label>
        <label className={LABEL}>
          What happens
          <select
            disabled={!info.canEdit}
            value={rule.action}
            onChange={(event) =>
              save({
                action: event.target.value,
                ...(event.target.value === "hold" ? {} : { holdOutcome: null }),
              })
            }
            className={INPUT}
          >
            <option value="confirm">Ask if they're sure, before it posts</option>
            <option value="hold">Hold it for approval</option>
            <option value="remove">Remove it</option>
            <option value="warn">Warn them</option>
          </select>
        </label>
        <ModeratorPicker
          actors={info.actors}
          value={rule.actorId}
          canEdit={info.canEdit}
          onChange={(actorId) => save({ actorId })}
        />
        {rule.action !== "confirm" && (
          <TimeField
            label={rule.action === "hold" ? "Decided after" : "How long after"}
            help="hours:minutes after they write it"
            valueMs={rule.afterMs}
            canEdit={info.canEdit}
            allowBefore={false}
            onSave={(afterMs) => save({ afterMs })}
          />
        )}
        {rule.action === "hold" && (
          <label className={LABEL}>
            How it ends
            <select
              disabled={!info.canEdit}
              value={rule.holdOutcome}
              onChange={(event) => save({ holdOutcome: event.target.value })}
              className={INPUT}
            >
              <option value="approve">Approved</option>
              <option value="remove">Removed</option>
            </select>
          </label>
        )}
      </div>
      <CastField
        label={speaks ? "What it says" : "Reason shown (optional)"}
        value={rule.message}
        canEdit={info.canEdit}
        required={speaks}
        multiline
        onSave={(message) => save({ message: message || null })}
      />
      <ConditionChoices
        all={info.conditions.map(({ key }) => key)}
        chosen={rule.conditions}
        canEdit={info.canEdit}
        onChange={(conditions) => save({ conditions })}
      />
      {problem && (
        <p role="alert" className="text-sm text-rose-700">
          {problem}
        </p>
      )}
      {info.canEdit && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => edits.remove.mutate(rule.id)}
            className="rounded border border-stone-300 px-2 py-1 text-xs"
          >
            Delete this rule
          </button>
        </div>
      )}
    </li>
  );
}

function AppealAnswerCard({
  answer,
  info,
  edits,
}: {
  answer: DraftInfo["appealAnswers"][number];
  info: DraftInfo;
  edits: DraftEdits;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const save = (changes: object) => {
    setProblem(null);
    edits.update.mutate(
      { itemId: answer.id, changes },
      { onError: (error) => setProblem(error.message) },
    );
  };
  return (
    <li aria-label="Answer to an appeal" className="space-y-2 rounded-lg bg-white p-3 shadow-sm">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={LABEL}>
          What happens
          <select
            disabled={!info.canEdit}
            value={answer.action}
            onChange={(event) => save({ action: event.target.value })}
            className={INPUT}
          >
            <option value="uphold">The removal stands</option>
            <option value="restore">It goes back up</option>
          </select>
        </label>
        <ModeratorPicker
          actors={info.actors}
          value={answer.actorId}
          canEdit={info.canEdit}
          onChange={(actorId) => save({ actorId })}
        />
        <TimeField
          label="How long after"
          help="hours:minutes after they appeal"
          valueMs={answer.afterMs}
          canEdit={info.canEdit}
          allowBefore={false}
          onSave={(afterMs) => save({ afterMs })}
        />
      </div>
      <CastField
        label="What the answer says"
        value={answer.message}
        canEdit={info.canEdit}
        required={answer.action === "uphold"}
        multiline
        onSave={(message) => save({ message: message || null })}
      />
      <ConditionChoices
        all={info.conditions.map(({ key }) => key)}
        chosen={answer.conditions}
        canEdit={info.canEdit}
        onChange={(conditions) => save({ conditions })}
      />
      {problem && (
        <p role="alert" className="text-sm text-rose-700">
          {problem}
        </p>
      )}
      {info.canEdit && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => edits.remove.mutate(answer.id)}
            className="rounded border border-stone-300 px-2 py-1 text-xs"
          >
            Delete this answer
          </button>
        </div>
      )}
    </li>
  );
}

function ContextNoteCard({
  note,
  info,
  edits,
}: {
  note: DraftInfo["contextNotes"][number];
  info: DraftInfo;
  edits: DraftEdits;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const save = (changes: object) => {
    setProblem(null);
    edits.update.mutate(
      { itemId: note.id, changes },
      { onError: (error) => setProblem(error.message) },
    );
  };
  const whole = (text: string, key: "helpful" | "notHelpful") => {
    const number = Number(text);
    if (Number.isInteger(number) && number >= 0) {
      save({ [key]: number });
    } else {
      setProblem("That has to be a whole number.");
    }
  };
  return (
    <li aria-label="Context note" className="space-y-2 rounded-lg bg-white p-3 shadow-sm">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={`${LABEL} sm:col-span-2`}>
          On this post
          <select
            disabled={!info.canEdit}
            value={note.targetId}
            onChange={(event) => save({ targetId: event.target.value })}
            className={INPUT}
          >
            {info.posts.map((post) => (
              <option key={post.id} value={post.id}>
                {post.authorName}: {shorten(post.title ?? post.body) || "(no text)"}
              </option>
            ))}
          </select>
        </label>
        <TimeField
          label="When"
          help="hours:minutes from when they start"
          valueMs={note.timeMs}
          canEdit={info.canEdit}
          allowBefore
          onSave={(timeMs) => save({ timeMs })}
        />
        <CastField
          label="Helpful ratings it starts with"
          value={String(note.helpful)}
          canEdit={info.canEdit}
          onSave={(text) => whole(text, "helpful")}
        />
        <CastField
          label="Not helpful ratings it starts with"
          value={String(note.notHelpful)}
          canEdit={info.canEdit}
          onSave={(text) => whole(text, "notHelpful")}
        />
      </div>
      <CastField
        label="What the note says"
        value={note.body}
        canEdit={info.canEdit}
        required
        multiline
        onSave={(body) => save({ body })}
      />
      <ConditionChoices
        all={info.conditions.map(({ key }) => key)}
        chosen={note.conditions}
        canEdit={info.canEdit}
        onChange={(conditions) => save({ conditions })}
      />
      {problem && (
        <p role="alert" className="text-sm text-rose-700">
          {problem}
        </p>
      )}
      {info.canEdit && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => edits.remove.mutate(note.id)}
            className="rounded border border-stone-300 px-2 py-1 text-xs"
          >
            Delete this note
          </button>
        </div>
      )}
    </li>
  );
}

/** What a moderator does in a study. It's written here, and freezes with a version (ADR 31, 32). */
export function ModerationPage() {
  const { draftId } = useParams({ from: "/drafts/$draftId/moderation" });
  const info = useQuery({
    queryKey: ["draft", draftId, "info"],
    queryFn: () => get<DraftInfo>(`/admin/drafts/${draftId}`),
  });
  const edits = useDraftEdits(draftId);
  useDraftPresence(draftId, null);
  const [problem, setProblem] = useState<string | null>(null);

  if (!info.data) {
    return null;
  }
  const data = info.data;
  const moderator =
    data.actors.find((actor) => actor.moderator)?.id ?? (data.actors[0]?.id as string);
  const removalOn = data.conditions.some(({ features }) => features.removal);
  const warningsOn = data.conditions.some(({ features }) => features.warnings);
  const firstPost = [...data.posts].sort((a, b) => a.offsetMs - b.offsetMs)[0];

  const add = (
    kind:
      | "removal"
      | "reaction"
      | "flagAnswer"
      | "ban"
      | "reportAnswer"
      | "autoRule"
      | "appealAnswer"
      | "contextNote",
    fields: object,
  ) => {
    setProblem(null);
    edits.create.mutate({ kind, fields }, { onError: (error) => setProblem(error.message) });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/drafts/$draftId" params={{ draftId }} className="text-sm underline">
          Back to the feed
        </Link>
        <h1 className="mr-auto text-lg font-semibold">Moderation in {data.title}</h1>
        {data.canEdit && <SaveStatus draftId={draftId} />}
      </div>
      <p className="text-sm text-stone-500">
        Nobody real moderates anything here. You write what a moderator does, and it can differ
        between conditions. A moderator can be anyone in the cast, including an account named as
        automatic. Telling a real person they broke a rule is a deception to raise with your IRB and
        in a debriefing.
      </p>
      {problem && (
        <p role="alert" className="text-sm text-rose-700">
          {problem}
        </p>
      )}

      <section aria-label="What the study wrote" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Removing what the study wrote</h2>
            <p className="text-sm text-stone-500">
              Someone can watch this happen to another person's post or comment.
            </p>
          </div>
          {data.canEdit && (
            <button
              type="button"
              disabled={!firstPost || !moderator || edits.create.isPending}
              title={!firstPost ? "Write a post first." : undefined}
              onClick={() =>
                add("removal", {
                  on: "post",
                  targetId: firstPost?.id,
                  actorId: moderator,
                  timeMs: firstPost?.offsetMs,
                  conditions: [],
                })
              }
              className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            >
              Add a removal
            </button>
          )}
        </div>
        {!removalOn && data.removals.length > 0 && (
          <p className="rounded bg-amber-100 p-2 text-sm text-amber-900">
            Moderators removing things is off in Settings, so these won't happen.
          </p>
        )}
        <ul className="space-y-3">
          {data.removals.map((removal) => (
            <RemovalCard key={removal.id} removal={removal} info={data} edits={edits} />
          ))}
        </ul>
      </section>

      <section aria-label="What someone flags" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Answering what someone flags</h2>
            <p className="text-sm text-stone-500">
              One naming a post or comment comes before one for anything else. Each person hears
              once for each thing they flag.
            </p>
          </div>
          {data.canEdit && (
            <button
              type="button"
              disabled={!moderator || edits.create.isPending}
              onClick={() =>
                add("flagAnswer", {
                  action: "answer",
                  actorId: moderator,
                  afterMs: 0,
                  message: "We looked at this, and no rule was broken.",
                  conditions: [],
                })
              }
              className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            >
              Add an answer
            </button>
          )}
        </div>
        <ul className="space-y-3">
          {data.flagAnswers.map((answer) => (
            <FlagAnswerCard key={answer.id} answer={answer} info={data} edits={edits} />
          ))}
        </ul>
      </section>

      <section aria-label="Context notes" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Context notes</h2>
            <p className="text-sm text-stone-500">
              A note on a post, as if readers had added context. People can rate whether it helps.
            </p>
          </div>
          {data.canEdit && (
            <button
              type="button"
              disabled={!firstPost || edits.create.isPending}
              title={!firstPost ? "Write a post first." : undefined}
              onClick={() =>
                add("contextNote", {
                  targetId: firstPost?.id,
                  body: "Readers added context here.",
                  timeMs: firstPost?.offsetMs,
                  conditions: [],
                })
              }
              className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            >
              Add a note
            </button>
          )}
        </div>
        <ul className="space-y-3">
          {data.contextNotes.map((note) => (
            <ContextNoteCard key={note.id} note={note} info={data} edits={edits} />
          ))}
        </ul>
      </section>

      <section aria-label="Automatic rules" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Automatic rules</h2>
            <p className="text-sm text-stone-500">
              Words in what a participant writes bring a response. The first rule that matches
              applies, in this order. A word list can catch someone disclosing something serious, so
              try yours out, and raise it with your IRB.
            </p>
          </div>
          {data.canEdit && (
            <button
              type="button"
              disabled={!moderator || edits.create.isPending}
              onClick={() =>
                add("autoRule", {
                  on: "both",
                  match: "example",
                  action: "confirm",
                  actorId: moderator,
                  afterMs: 0,
                  message: "This might break a rule. Are you sure you want to post it?",
                  conditions: [],
                })
              }
              className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            >
              Add a rule
            </button>
          )}
        </div>
        <ul className="space-y-3">
          {data.autoRules.map((rule) => (
            <AutoRuleCard key={rule.id} rule={rule} info={data} edits={edits} />
          ))}
        </ul>
      </section>

      <section aria-label="Answers to appeals" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Answering appeals</h2>
            <p className="text-sm text-stone-500">
              When someone appeals a removal of what they wrote. The first that applies to their
              condition is used. With none, they get no answer.
            </p>
          </div>
          {data.canEdit && (
            <button
              type="button"
              disabled={!moderator || edits.create.isPending}
              onClick={() =>
                add("appealAnswer", {
                  action: "uphold",
                  actorId: moderator,
                  afterMs: 0,
                  message: "We looked at your appeal, and the removal stands.",
                  conditions: [],
                })
              }
              className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            >
              Add an answer
            </button>
          )}
        </div>
        <ul className="space-y-3">
          {data.appealAnswers.map((answer) => (
            <AppealAnswerCard key={answer.id} answer={answer} info={data} edits={edits} />
          ))}
        </ul>
      </section>

      <section aria-label="Who's banned" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Banning someone in the cast</h2>
            <p className="text-sm text-stone-500">
              What they wrote before stays. What they're written to post after doesn't appear, and
              their scripted reactions stop. Participants are never banned themselves.
            </p>
          </div>
          {data.canEdit && (
            <button
              type="button"
              disabled={!moderator || edits.create.isPending}
              onClick={() =>
                add("ban", {
                  bannedActorId:
                    data.actors.find((actor) => !actor.moderator)?.id ?? data.actors[0]?.id,
                  actorId: moderator,
                  timeMs: 0,
                  conditions: [],
                })
              }
              className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            >
              Add a ban
            </button>
          )}
        </div>
        <ul className="space-y-3">
          {data.bans.map((ban) => (
            <BanCard key={ban.id} ban={ban} info={data} edits={edits} />
          ))}
        </ul>
      </section>

      <section aria-label="Who someone reports" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Answering when someone reports a person</h2>
            <p className="text-sm text-stone-500">
              One naming a person comes before one for anyone else. A ban from a report only applies
              for the person who reported them.
            </p>
          </div>
          {data.canEdit && (
            <button
              type="button"
              disabled={!moderator || edits.create.isPending}
              onClick={() =>
                add("reportAnswer", {
                  action: "answer",
                  actorId: moderator,
                  afterMs: 0,
                  message: "We looked at your report, and no rule was broken.",
                  conditions: [],
                })
              }
              className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            >
              Add an answer
            </button>
          )}
        </div>
        <ul className="space-y-3">
          {data.reportAnswers.map((answer) => (
            <ReportAnswerCard key={answer.id} answer={answer} info={data} edits={edits} />
          ))}
        </ul>
      </section>

      <section aria-label="What a participant writes" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Responding to what a participant writes</h2>
            <p className="text-sm text-stone-500">
              This happens after their first post, say, or their third comment. A warning stays on
              their screen until they press its button.
            </p>
          </div>
          {data.canEdit && (
            <button
              type="button"
              disabled={!moderator || edits.create.isPending}
              onClick={() =>
                add("reaction", {
                  on: "post",
                  nth: 0,
                  type: removalOn || !warningsOn ? "remove" : "warn",
                  actorId: moderator,
                  afterMs: 0,
                  conditions: [],
                })
              }
              className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            >
              Add a response
            </button>
          )}
        </div>
        <ul className="space-y-3">
          {data.moderatorReactions.map((reaction) => (
            <ReactionCard key={reaction.id} reaction={reaction} info={data} edits={edits} />
          ))}
        </ul>
      </section>
    </div>
  );
}
