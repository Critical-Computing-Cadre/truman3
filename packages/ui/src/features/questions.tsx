import {
  type AskedQuestion,
  type FeedQuestion,
  problemWithAnswers,
  type QuestionAnswer,
  scaleEnds,
} from "@truman3/core";
import { useId, useRef, useState } from "react";
import { useFeature } from "../platform.tsx";

/**
 * What a beat asks a participant, there and then (ADR 89). It sits at the bottom of the screen,
 * over whatever page they're on, until they answer or put it aside. It keeps when it first
 * appeared, so how long they took can be recorded with their answer.
 */
export function QuestionCard({
  question,
  busy = false,
  error,
  onAnswer,
  onDismiss,
}: {
  question: FeedQuestion;
  busy?: boolean;
  error?: string | undefined;
  onAnswer: (id: string, answers: Record<string, QuestionAnswer>, shownAt: string) => void;
  onDismiss: (id: string, shownAt: string) => void;
}) {
  const shownAt = useRef(new Date().toISOString());
  const [answers, setAnswers] = useState<Record<string, QuestionAnswer>>({});
  const heading = useId();
  if (!useFeature("questions")) {
    return null;
  }
  const set = (id: string, answer: QuestionAnswer | undefined) =>
    setAnswers((before) => {
      const { [id]: _, ...rest } = before;
      return answer === undefined ? rest : { ...rest, [id]: answer };
    });
  const ready = problemWithAnswers(question.questions, answers) === null;

  return (
    <section
      aria-labelledby={heading}
      data-testid="question-card"
      className="fixed inset-x-0 bottom-14 z-40 mx-auto max-h-[70dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-stone-300 bg-white p-4 text-sm text-stone-900 shadow-2xl sm:bottom-4 sm:rounded-2xl"
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && !busy) {
            onAnswer(question.id, answers, shownAt.current);
          }
        }}
      >
        <h2 id={heading} className="font-semibold">
          {question.title ?? "A quick question"}
        </h2>
        {question.questions.map((asked) => (
          <Asked
            key={asked.id}
            asked={asked}
            answer={answers[asked.id]}
            onChange={(answer) => set(asked.id, answer)}
          />
        ))}
        {error && (
          <p role="alert" className="text-rose-700">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          {!question.required && (
            <button
              type="button"
              disabled={busy}
              className="rounded px-3 py-1.5 text-stone-600 hover:bg-stone-100"
              onClick={() => onDismiss(question.id, shownAt.current)}
            >
              Not now
            </button>
          )}
          <button
            type="submit"
            disabled={!ready || busy}
            className="rounded bg-accent-fill px-4 py-1.5 font-medium text-on-accent disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </form>
    </section>
  );
}

function Asked({
  asked,
  answer,
  onChange,
}: {
  asked: AskedQuestion;
  answer: QuestionAnswer | undefined;
  onChange: (answer: QuestionAnswer | undefined) => void;
}) {
  const name = useId();
  if (asked.type === "text") {
    return (
      <label className="block space-y-1.5">
        <span className="block font-medium">{asked.text}</span>
        <textarea
          rows={2}
          maxLength={500}
          value={typeof answer === "string" ? answer : ""}
          onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value)}
          className="w-full rounded border border-stone-300 bg-white p-2"
        />
      </label>
    );
  }
  if (asked.type === "scale") {
    const { min, max } = scaleEnds(asked);
    const points = Array.from({ length: max - min + 1 }, (_, index) => min + index);
    return (
      <fieldset className="space-y-1.5">
        <legend className="font-medium">{asked.text}</legend>
        <div className="flex gap-1">
          {points.map((point) => (
            <label
              key={point}
              className="flex min-w-0 flex-1 cursor-pointer items-center justify-center rounded border border-stone-300 py-2 has-checked:border-accent has-checked:bg-accent-fill has-checked:text-on-accent has-focus-visible:ring-2 has-focus-visible:ring-accent"
            >
              <input
                type="radio"
                name={name}
                value={point}
                checked={answer === point}
                onChange={() => onChange(point)}
                className="sr-only"
              />
              {point}
            </label>
          ))}
        </div>
        {(asked.minLabel || asked.maxLabel) && (
          <div aria-hidden="true" className="flex justify-between text-xs text-stone-500">
            <span>{asked.minLabel}</span>
            <span>{asked.maxLabel}</span>
          </div>
        )}
      </fieldset>
    );
  }
  const chosen = Array.isArray(answer) ? answer : [];
  return (
    <fieldset className="space-y-1.5">
      <legend className="font-medium">{asked.text}</legend>
      {(asked.choices ?? []).map((choice) =>
        asked.type === "choice" ? (
          <label key={choice} className="flex cursor-pointer items-baseline gap-2">
            <input
              type="radio"
              name={name}
              checked={answer === choice}
              onChange={() => onChange(choice)}
            />
            {choice}
          </label>
        ) : (
          <label key={choice} className="flex cursor-pointer items-baseline gap-2">
            <input
              type="checkbox"
              checked={chosen.includes(choice)}
              onChange={(event) => {
                const next = event.target.checked
                  ? [...chosen, choice]
                  : chosen.filter((other) => other !== choice);
                onChange(next.length === 0 ? undefined : next);
              }}
            />
            {choice}
          </label>
        ),
      )}
    </fieldset>
  );
}
