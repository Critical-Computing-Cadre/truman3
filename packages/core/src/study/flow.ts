import type { StudySettings } from "./definition.ts";
import { HOUR_MS } from "./time.ts";

type FlowStep = StudySettings["flow"][number];

export interface CurrentFlowStep {
  /** The step, or null if they've gone past the end of the flow. */
  step: FlowStep | null;
  /** Where that step is in the flow, which can be ahead of where they were. */
  position: number;
}

/**
 * Which step a participant is on. Once a study's length has passed, anyone still before the end of
 * the feed step moves past it. They've had their time in the feed, but they still get the steps
 * after it, like a survey.
 */
export function currentFlowStep(
  settings: StudySettings,
  position: number,
  elapsedMs: number,
): CurrentFlowStep {
  const lengthMs = settings.length.days * 24 * HOUR_MS;
  const feedPosition = settings.flow.findIndex(({ step }) => step === "feed");
  const effective =
    elapsedMs >= lengthMs && feedPosition !== -1 && position <= feedPosition
      ? feedPosition + 1
      : position;

  return { step: settings.flow[effective] ?? null, position: effective };
}

/** Whether a participant may choose to leave the feed step yet. */
export function canLeaveFeed(step: FlowStep, elapsedMs: number): boolean {
  return (
    step.step === "feed" &&
    step.finishAfterMinutes !== undefined &&
    elapsedMs >= step.finishAfterMinutes * 60_000
  );
}
