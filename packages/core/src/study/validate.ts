import type { StudyDefinition } from "./definition.ts";
import { HOUR_MS } from "./time.ts";

export interface StudyIssue {
  /** Errors stop a study from being imported. Warnings don't. */
  severity: "error" | "warning";
  message: string;
  file?: string | undefined;
  row?: number | undefined;
}

type Source = { file: string; row: number } | undefined;

/**
 * Checks the rules that span more than one item, such as whether a post's actor exists.
 * Messages are written for researchers, and this has no file handling, so a visual builder
 * can use the same checks as the command line.
 */
export function validateStudy(study: StudyDefinition): StudyIssue[] {
  const issues: StudyIssue[] = [];
  const error = (message: string, source?: Source) =>
    issues.push({ severity: "error", message, file: source?.file, row: source?.row });
  const warning = (message: string, source?: Source) =>
    issues.push({ severity: "warning", message, file: source?.file, row: source?.row });

  const { settings } = study;
  const armKeys = new Set(settings.conditions.arms.map((arm) => arm.key));

  const seenArms = new Set<string>();
  for (const arm of settings.conditions.arms) {
    if (seenArms.has(arm.key)) {
      error(`The condition "${arm.key}" is listed more than once.`);
    }
    seenArms.add(arm.key);
  }

  const { assignment } = settings.conditions;
  if (assignment.method === "blocked") {
    const totalWeight = settings.conditions.arms.reduce((sum, arm) => sum + arm.weight, 0);
    if (assignment.blockSize % totalWeight !== 0) {
      error(
        `The block size (${assignment.blockSize}) has to divide evenly by the total condition weight (${totalWeight}), or blocks can't be balanced.`,
      );
    }
  }

  const checkConditions = (conditions: string[], label: string, source: Source) => {
    for (const condition of conditions) {
      if (!armKeys.has(condition)) {
        error(`${label} uses the condition "${condition}", which isn't in study.yaml.`, source);
      }
    }
  };

  const usernames = new Set<string>();
  for (const actor of study.actors) {
    if (usernames.has(actor.username)) {
      error(`The username "${actor.username}" is used by more than one actor.`, actor.source);
    }
    usernames.add(actor.username);
    checkConditions(actor.conditions, `Actor "${actor.username}"`, actor.source);
  }

  const checkActor = (username: string, label: string, source: Source) => {
    if (!usernames.has(username)) {
      error(`${label} is by "${username}", who isn't in the list of actors.`, source);
    }
  };

  const posts = new Map<string, StudyDefinition["posts"][number]>();
  for (const post of study.posts) {
    const label = `Post "${post.ref}"`;
    if (posts.has(post.ref)) {
      error(`The post ID "${post.ref}" is used more than once.`, post.source);
    }
    posts.set(post.ref, post);
    checkActor(post.actor, label, post.source);
    checkConditions(post.conditions, label, post.source);
    if (!post.body && !post.picture) {
      error(`${label} has no text and no picture.`, post.source);
    }
  }

  const commentRefs = new Set<string>();
  for (const comment of study.comments) {
    const label = `Comment "${comment.ref}"`;
    if (commentRefs.has(comment.ref)) {
      error(`The comment ID "${comment.ref}" is used more than once.`, comment.source);
    }
    commentRefs.add(comment.ref);
    checkActor(comment.actor, label, comment.source);
    checkConditions(comment.conditions, label, comment.source);

    const post = posts.get(comment.post);
    if (!post) {
      error(`${label} is on post "${comment.post}", which doesn't exist.`, comment.source);
    } else if (comment.timeMs < post.timeMs) {
      error(`${label} is timed before the post it's on ("${post.ref}").`, comment.source);
    }
  }

  for (const reaction of study.reactions) {
    const label = `The reaction to the participant's ${reaction.on} #${reaction.nth}`;
    checkActor(reaction.actor, label, reaction.source);
    checkConditions(reaction.conditions, label, reaction.source);
    if (reaction.type === "reply" && !reaction.body) {
      error(`${label} is a reply, but has no text.`, reaction.source);
    }
    if (reaction.type !== "reply" && reaction.body) {
      error(`${label} is a ${reaction.type}, so it can't have text.`, reaction.source);
    }
  }

  const steps = settings.flow.map((step) => step.step);
  if (steps.filter((step) => step === "feed").length !== 1) {
    error("The flow needs exactly one feed step.");
  }
  const exitIndex = steps.indexOf("exit");
  if (exitIndex !== -1 && exitIndex !== steps.length - 1) {
    error("The exit step has to be last in the flow.");
  }
  for (const step of settings.flow) {
    if ((step.step === "consent" || step.step === "page") && !(step.page in study.pages)) {
      error(`The flow uses the page "${step.page}", which doesn't exist.`);
    }
  }

  const lengthMs = settings.length.days * 24 * HOUR_MS;
  const windows = [settings.feed.windowHours];
  for (const arm of settings.conditions.arms) {
    if (arm.feed && "windowHours" in arm.feed) {
      windows.push(arm.feed.windowHours);
    }
  }
  const widestWindowMs = windows.includes(undefined)
    ? null
    : Math.max(...windows.map((hours) => (hours ?? 0) * HOUR_MS));

  for (const post of study.posts) {
    if (post.timeMs >= lengthMs) {
      warning(
        `Post "${post.ref}" will never appear: it's timed after the study ends.`,
        post.source,
      );
    } else if (widestWindowMs !== null && post.timeMs < -widestWindowMs) {
      warning(
        `Post "${post.ref}" will never appear: it's already outside the feed window when a participant starts.`,
        post.source,
      );
    }
  }

  const targeted = new Set(
    [...study.actors, ...study.posts, ...study.comments, ...study.reactions].flatMap(
      (item) => item.conditions,
    ),
  );
  const hasOverrides = settings.conditions.arms.some((arm) => arm.feed);
  if (settings.conditions.arms.length > 1 && !hasOverrides) {
    for (const arm of settings.conditions.arms) {
      if (!targeted.has(arm.key)) {
        warning(
          `Nothing differs for the condition "${arm.key}": no content targets it and it has no settings of its own.`,
        );
      }
    }
  }

  return issues;
}

export function hasErrors(issues: StudyIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}
