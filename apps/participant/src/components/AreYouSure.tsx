import { useQuery } from "@tanstack/react-query";
import type { Written } from "../api.ts";
import { flowQuery, post } from "../api.ts";

const DARK = "rounded bg-accent-fill px-3 py-1.5 text-on-accent";
const LIGHT = "rounded border border-stone-400 px-3 py-1.5";

/**
 * A rule asking if someone's sure before what they wrote goes up. Either answer is recorded. The study
 * chooses which button is dark, the one it nudges people toward.
 */
export function AreYouSure({
  asked,
  sending,
  onPost,
  onBack,
}: {
  asked: NonNullable<Written["confirm"]>;
  sending: boolean;
  onPost: () => void;
  onBack: () => void;
}) {
  const flow = useQuery(flowQuery);
  const postDark = flow.data?.sureButton === "postAnyway";
  return (
    <section
      role="alert"
      data-testid="are-you-sure"
      className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm"
    >
      <p className="font-semibold">A message from {asked.by}</p>
      <p className="mt-1 break-words whitespace-pre-wrap">{asked.message}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={sending}
          onClick={() => {
            post("/moderation/confirm-answered", { rule: asked.rule }).catch(() => {});
            onBack();
          }}
          className={postDark ? LIGHT : DARK}
        >
          Go back and edit
        </button>
        <button
          type="button"
          disabled={sending}
          onClick={onPost}
          className={postDark ? DARK : LIGHT}
        >
          Post anyway
        </button>
      </div>
    </section>
  );
}
