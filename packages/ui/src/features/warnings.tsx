import type { FeedWarning } from "@truman3/core";
import { useFeature } from "../platform.tsx";

/** A moderator's warning. It stays on every page until they press its button, which is recorded. */
export function WarningNotice({
  warning,
  onAcknowledge,
}: {
  warning: FeedWarning;
  onAcknowledge: (id: string) => void;
}) {
  if (!useFeature("warnings")) {
    return null;
  }
  return (
    <section
      role="alert"
      data-testid="warning-notice"
      className="border-y border-amber-300 bg-amber-50 p-3 text-sm sm:rounded-lg sm:border"
    >
      <p className="font-semibold">
        A warning from {warning.by} about your {warning.kind}
      </p>
      <p className="mt-1 break-words whitespace-pre-wrap">{warning.message}</p>
      <button
        type="button"
        className="mt-2 rounded bg-accent-fill px-3 py-1.5 text-on-accent"
        onClick={() => onAcknowledge(warning.id)}
      >
        I understand
      </button>
    </section>
  );
}
