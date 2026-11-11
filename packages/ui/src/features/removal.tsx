import type { FeedRemoved } from "@truman3/core";
import { useState } from "react";
import type { PostActions } from "../post-props.ts";

/** Where a participant appeals a moderator's removal or label of what they wrote, once. */
export function Appeal({
  id,
  state,
  actions,
  question = "Why should this go back up?",
}: {
  id: string;
  state: "open" | "sent";
  actions?: PostActions | undefined;
  question?: string;
}) {
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  if (state === "sent") {
    return <p className="mt-1 text-xs">You've appealed this.</p>;
  }
  if (!actions?.onAppeal) {
    return null;
  }
  if (!writing) {
    return (
      <button type="button" className="mt-1 underline" onClick={() => setWriting(true)}>
        Appeal
      </button>
    );
  }
  return (
    <div className="mt-2 space-y-1">
      <label className="flex flex-col gap-1 text-xs font-medium">
        {question}
        <textarea
          rows={3}
          maxLength={2000}
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="rounded border border-stone-300 p-2 text-sm font-normal text-stone-900"
        />
      </label>
      <button
        type="button"
        disabled={!text.trim()}
        className="rounded bg-stone-900 px-3 py-1 text-white disabled:opacity-40"
        onClick={() => actions.onAppeal?.(id, text.trim())}
      >
        Send appeal
      </button>
    </div>
  );
}

/**
 * What takes the place of something a moderator removed, or says it's waiting for them. Its author
 * still has what they wrote, so they're told that nobody else can see it. Everyone else gets only
 * this, from the server.
 */
export function RemovedNote({
  item,
  actions,
  className = "",
}: {
  item: {
    id: string;
    removed?: FeedRemoved | undefined;
    held?: true | undefined;
    author: { isViewer: boolean };
  };
  actions?: PostActions | undefined;
  className?: string;
}) {
  const box = `rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600 ${className}`;
  if (item.held) {
    return (
      <p data-testid="held-note" className={box}>
        Waiting for a moderator's approval. Nobody else can see this yet.
      </p>
    );
  }
  // The server sends a removal only where removals apply: with removal on, or in a shared world,
  // where a researcher can always take something down (ADR 68).
  if (!item.removed) {
    return null;
  }
  const { by, reason, appeal } = item.removed;
  return (
    <div data-testid="removed-note" className={box}>
      <p className="font-medium">
        Removed by {by}.{item.author.isViewer ? " Nobody else can see this now." : ""}
      </p>
      {reason && <p className="break-words whitespace-pre-wrap">Reason: {reason}</p>}
      {appeal && <Appeal id={item.id} state={appeal} actions={actions} />}
    </div>
  );
}
