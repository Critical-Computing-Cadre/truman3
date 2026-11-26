import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { send } from "../api.ts";

export interface Persona {
  about?: string;
  voice?: string;
  values?: string;
  goals?: string;
  relationships?: Record<string, string>;
  redLines: string[];
}

const field = "flex flex-col gap-1 text-xs font-medium text-stone-600";
const input = "rounded border border-stone-300 px-2 py-1 text-sm font-normal text-stone-900";

const FIELDS = [
  ["about", "About them", "A retired teacher who moved here two years ago. Knows everyone."],
  ["voice", "How they write", "Short sentences, no emoji, dry humor."],
  ["values", "What they care about", "Fairness, and people keeping their word."],
  ["goals", "What they want", "To get the crossing on Main Street fixed."],
] as const;

/**
 * Someone's persona card (ADR 52), as a form: who they are when a model writes for them, in live
 * writing, rehearsed lines, and the community. It's kept in beats.yaml, and saved as a whole.
 */
export function PersonaCard({
  draftId,
  username,
  name,
  card,
  others,
  canEdit,
}: {
  draftId: string;
  username: string;
  name: string;
  /** Their card as saved, if they have one. */
  card: Persona | undefined;
  /** Everyone else in the cast, for how this person feels about them. */
  others: { username: string; name: string }[];
  canEdit: boolean;
}) {
  const client = useQueryClient();
  const [text, setText] = useState<Record<string, string>>({});
  const [feelings, setFeelings] = useState<[string, string][]>([]);
  const [redLines, setRedLines] = useState("");
  // The form follows what's saved, whenever that changes.
  useEffect(() => {
    setText({
      about: card?.about ?? "",
      voice: card?.voice ?? "",
      values: card?.values ?? "",
      goals: card?.goals ?? "",
    });
    setFeelings(Object.entries(card?.relationships ?? {}));
    setRedLines((card?.redLines ?? []).join("\n"));
  }, [card]);

  const save = useMutation({
    mutationFn: () =>
      send("PUT", `/admin/drafts/${draftId}/persona-cards/${encodeURIComponent(username)}`, {
        ...text,
        relationships: Object.fromEntries(feelings.filter(([who, feeling]) => who && feeling)),
        redLines: redLines
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["draft", draftId] }),
  });
  const filled = card
    ? [card.about, card.voice, card.values, card.goals].filter(Boolean).length +
      Object.keys(card.relationships ?? {}).length +
      card.redLines.length
    : 0;
  const unused = [{ username: "participant", name: "Whoever takes part" }, ...others].filter(
    (other) => !feelings.some(([who]) => who === other.username),
  );

  return (
    <details className="border-t border-stone-200 pt-2">
      <summary className="cursor-pointer text-sm font-medium">
        Persona card{" "}
        <span className="font-normal text-stone-500">
          {filled > 0 ? "(filled in)" : "(empty)"}: who {name} is when a model writes for them
        </span>
      </summary>
      <form
        className="mt-2 grid gap-2 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        {FIELDS.map(([key, label, example]) => (
          <label key={key} className={field}>
            {label}
            <textarea
              rows={2}
              disabled={!canEdit}
              value={text[key] ?? ""}
              onChange={(event) => setText({ ...text, [key]: event.target.value })}
              placeholder={example}
              className={input}
            />
          </label>
        ))}
        <fieldset className="space-y-1 sm:col-span-2">
          <legend className="text-xs font-medium text-stone-600">How they feel about others</legend>
          {feelings.map(([who, feeling], index) => (
            <div key={who} className="flex flex-wrap items-center gap-2">
              <span className="w-40 text-sm">
                {who === "participant"
                  ? "Whoever takes part"
                  : (others.find((other) => other.username === who)?.name ?? `@${who}`)}
              </span>
              <input
                aria-label={`How ${name} feels about ${who}`}
                disabled={!canEdit}
                value={feeling}
                onChange={(event) =>
                  setFeelings(
                    feelings.map((entry, at) =>
                      at === index ? [entry[0], event.target.value] : entry,
                    ),
                  )
                }
                placeholder="Old friends. Teases them a little."
                className={`${input} min-w-0 flex-1`}
              />
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setFeelings(feelings.filter((_, at) => at !== index))}
                  className="btn btn-sm"
                  aria-label={`Take ${who} off ${name}'s card`}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {canEdit && unused.length > 0 && (
            <select
              aria-label={`Add someone ${name} has feelings about`}
              value=""
              onChange={(event) => setFeelings([...feelings, [event.target.value, ""]])}
              className={input}
            >
              <option value="">Add someone...</option>
              {unused.map((other) => (
                <option key={other.username} value={other.username}>
                  {other.name || other.username}
                </option>
              ))}
            </select>
          )}
        </fieldset>
        <label className={`${field} sm:col-span-2`}>
          What they never say (one a line)
          <textarea
            rows={2}
            disabled={!canEdit}
            value={redLines}
            onChange={(event) => setRedLines(event.target.value)}
            placeholder="Never gives medical advice."
            className={input}
          />
        </label>
        {save.error && (
          <p role="alert" className="text-sm text-rose-700 sm:col-span-2">
            {save.error.message}
          </p>
        )}
        {canEdit && (
          <div className="flex items-center gap-2 sm:col-span-2">
            <button type="submit" disabled={save.isPending} className="btn btn-sm btn-primary">
              Save {name}'s card
            </button>
            {save.isSuccess && !save.isPending && (
              <span role="status" className="text-xs text-stone-600">
                Saved
              </span>
            )}
          </div>
        )}
      </form>
    </details>
  );
}
