import type { FeedLabel } from "@truman3/core";
import { type ReactNode, useState } from "react";
import { useFeature } from "../platform.tsx";
import type { PostActions } from "../post-props.ts";
import { Appeal } from "./removal.tsx";

interface Labeled {
  id: string;
  labels?: FeedLabel[] | undefined;
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 shrink-0 fill-current">
      <path d="M10 2 1 18h18L10 2Zm-1 6h2v5H9V8Zm0 6h2v2H9v-2Z" />
    </svg>
  );
}

/**
 * A moderator's labels on a post or comment, such as "Spam", and whether they cover it. A label
 * that hides covers what it's on until someone presses Show, which is recorded. Others sit above
 * it, as does one that's been shown. The server never sends a cover over someone's own post.
 * A layout puts `bar` where the label goes, and leaves out what it covers while `covered`.
 */
export function useLabels(
  item: Labeled,
  actions?: PostActions | undefined,
  editing = false,
): { bar: ReactNode; covered: boolean } {
  const on = useFeature("labels");
  const [shown, setShown] = useState(false);
  const labels = on ? (item.labels ?? []) : [];
  if (labels.length === 0) {
    return { bar: null, covered: false };
  }
  const covering = labels.filter(({ hides }) => hides);
  const covered = covering.length > 0 && !shown && !editing;
  const appeal = labels.find((label) => label.appeal)?.appeal;
  const names = (list: FeedLabel[]) => list.map(({ text }) => text).join(", ");
  const by = [...new Set(labels.map((label) => label.by))].join(", ");

  if (covered) {
    return {
      covered,
      bar: (
        <div
          data-testid="label-cover"
          className="flex items-center gap-2 rounded-lg bg-stone-100 px-3 py-2.5 text-sm text-stone-700"
        >
          <WarningIcon />
          <span className="min-w-0 flex-1">
            <span className="font-semibold">{names(covering)}</span>
            <span className="block text-xs text-stone-500">Labeled by {by}</span>
          </span>
          <button
            type="button"
            className="shrink-0 rounded-full px-3 py-1 font-semibold underline-offset-2 hover:underline"
            onClick={() => {
              setShown(true);
              for (const { text } of covering) {
                actions?.onLabelShown?.(item.id, text);
              }
            }}
          >
            Show
          </button>
        </div>
      ),
    };
  }

  const reasons = labels.flatMap(({ reason }) => (reason ? [reason] : []));
  return {
    covered,
    bar: (
      <div data-testid="label-bar" className="text-xs text-stone-600">
        <p className="flex items-center gap-1.5">
          <WarningIcon />
          <span>
            <span className="font-semibold">{names(labels)}</span> · Labeled by {by}
          </span>
          {covering.length > 0 && (
            <button
              type="button"
              className="ml-auto font-semibold underline-offset-2 hover:underline"
              onClick={() => setShown(false)}
            >
              Hide
            </button>
          )}
        </p>
        {reasons.map((reason) => (
          <p key={reason} className="mt-0.5 break-words whitespace-pre-wrap">
            Reason: {reason}
          </p>
        ))}
        {appeal && (
          <Appeal
            id={item.id}
            state={appeal}
            actions={actions}
            question="Why shouldn't this have this label?"
          />
        )}
      </div>
    ),
  };
}
