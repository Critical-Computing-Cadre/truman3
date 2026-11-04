import { MAX_ATTACHMENTS } from "../feed.ts";
import { hasPlaceholderConsent } from "./consent.ts";
import type { StudyDefinition } from "./definition.ts";
import { LINK_PLACEHOLDERS } from "./links.ts";
import { featuresFor } from "./platform.ts";
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

  if (hasPlaceholderConsent(settings, study.pages)) {
    warning("The consent page still has the placeholder text. Replace it before launching.");
  }

  // Two conditions a participant couldn't tell apart are usually a mistake. This comes first, since
  // a study can have many warnings about its posts, and this one matters more.
  const shownIn = (key: string, items: readonly { conditions: string[] }[]) =>
    items.flatMap((item, index) =>
      item.conditions.length === 0 || item.conditions.includes(key) ? [index] : [],
    );
  const conditionLooks = new Map<string, string>();
  for (const arm of settings.conditions.arms) {
    const looks = JSON.stringify([
      arm.feed ?? {},
      arm.platform ?? {},
      shownIn(arm.key, study.spaces),
      shownIn(arm.key, study.actors),
      shownIn(arm.key, study.posts),
      shownIn(arm.key, study.comments),
      shownIn(arm.key, study.reactions),
    ]);
    const same = conditionLooks.get(looks);
    if (same) {
      warning(
        `The conditions "${same}" and "${arm.key}" are identical, so nothing differs between them.`,
      );
    } else {
      conditionLooks.set(looks, arm.key);
    }
  }

  // Content written for a feature that's off in a condition never shows there, which is easy to miss
  // when features differ between conditions.
  for (const arm of settings.conditions.arms) {
    const on = featuresFor(settings, arm.key);
    const applies = (item: { conditions: string[] }) =>
      item.conditions.length === 0 || item.conditions.includes(arm.key);
    const hidden = study.comments.filter(applies).length;
    if (!on.comments && hidden > 0) {
      warning(`Comments are off in "${arm.key}", so ${hidden} written comments won't show there.`);
    }
    const replies = study.comments.filter((item) => applies(item) && item.replyTo).length;
    if (on.comments && !on.threads && replies > 0) {
      warning(
        `Replies to replies are off in "${arm.key}", so ${replies} replies show as ordinary comments, in time order.`,
      );
    }
    if (on.threads && !on.comments) {
      warning(`Replies to replies are on in "${arm.key}", but they need comments, which are off.`);
    }
    const galleries = study.posts.filter((post) => applies(post) && post.pictures.length > 1);
    if (!on.galleries && galleries.length > 0) {
      warning(
        `Several photos on a post are off in "${arm.key}", so ${galleries.length} posts show only their first.`,
      );
    }
    const reactions = study.reactions.filter(applies);
    if (!on.comments && reactions.some(({ type }) => type === "reply")) {
      warning(`Comments are off in "${arm.key}", so its scripted replies won't happen.`);
    }
    if (!on.likes && reactions.some(({ type }) => type === "like")) {
      warning(`Likes are off in "${arm.key}", so its scripted likes won't happen.`);
    }
    if (!on.votes && reactions.some(({ type }) => type === "up" || type === "down")) {
      warning(`Votes are off in "${arm.key}", so its scripted votes won't happen.`);
    }
    const voted = [...study.posts, ...study.comments].filter(
      (item) => applies(item) && (item.ups || item.downs),
    ).length;
    if (!on.votes && voted > 0) {
      warning(`Votes are off in "${arm.key}", so ${voted} written vote counts won't show there.`);
    }
    if (!on.notifications && reactions.some(({ type }) => type === "read")) {
      warning(`Notifications are off in "${arm.key}", so its "read" reactions won't show.`);
    }
    if (!on.posting && reactions.some((reaction) => reaction.on === "post")) {
      warning(`Writing posts is off in "${arm.key}", so reactions to their posts can't happen.`);
    }
    if (!on.comments && reactions.some((reaction) => reaction.on === "comment")) {
      warning(`Comments are off in "${arm.key}", so reactions to their comments can't happen.`);
    }
  }

  // Where posts go is the research team's choice, so these only point out what's easy to miss.
  const spacesIn = settings.conditions.arms.map((arm) => ({
    key: arm.key,
    on: featuresFor(settings, arm.key).spaces,
    seen: study.spaces
      .filter(({ conditions }) => conditions.length === 0 || conditions.includes(arm.key))
      .map(({ key }) => key)
      .join(","),
  }));
  if (study.spaces.length > 0) {
    for (const { key, on } of spacesIn) {
      if (!on) {
        warning(
          `Spaces are off in "${key}", so there are no community pages there, and posts in spaces show in the one feed.`,
        );
      }
    }
    const withSpaces = spacesIn.filter(({ on }) => on);
    if (new Set(withSpaces.map(({ seen }) => seen)).size > 1) {
      warning(
        `The conditions see different spaces: ${withSpaces.map(({ key, seen }) => `"${key}" sees ${seen || "none"}`).join("; ")}. Check that's what you mean to compare.`,
      );
    }
  }
  for (const arm of settings.conditions.arms) {
    const on = featuresFor(settings, arm.key);
    const orders = [
      arm.feed?.ranker ?? settings.feed.ranker,
      arm.feed?.spaceRanker ?? settings.feed.spaceRanker,
    ];
    if (!on.votes && orders.includes("top")) {
      warning(
        `The top order is used in "${arm.key}", but votes are off there, so it only follows the scores written in the study.`,
      );
    }
    if (!on.spaces && (arm.feed?.spaceRanker ?? settings.feed.spaceRanker)) {
      warning(`An order for space pages is set, but spaces are off in "${arm.key}".`);
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

  const spacesByKey = new Map<string, StudyDefinition["spaces"][number]>();
  for (const space of study.spaces) {
    if (spacesByKey.has(space.key)) {
      error(`The space "${space.key}" is listed more than once.`, space.source);
    }
    spacesByKey.set(space.key, space);
    checkConditions(space.conditions, `Space "${space.key}"`, space.source);
  }

  const posts = new Map<string, StudyDefinition["posts"][number]>();
  for (const post of study.posts) {
    const label = `Post "${post.ref}"`;
    if (posts.has(post.ref)) {
      error(`The post ID "${post.ref}" is used more than once.`, post.source);
    }
    posts.set(post.ref, post);
    checkActor(post.actor, label, post.source);
    checkConditions(post.conditions, label, post.source);
    if (post.space) {
      const space = spacesByKey.get(post.space);
      if (!space) {
        error(`${label} is in the space "${post.space}", which doesn't exist.`, post.source);
      } else if (space.conditions.length > 0) {
        const missing = (post.conditions.length > 0 ? post.conditions : [...armKeys]).filter(
          (key) => !space.conditions.includes(key),
        );
        if (missing.length > 0) {
          warning(
            `${label} won't show in ${missing.join(", ")}, because its space, "${space.key}", doesn't.`,
            post.source,
          );
        }
      }
    }
    if (!post.body && post.pictures.length === 0) {
      error(`${label} has no text and no picture.`, post.source);
    }
    if (post.pictures.length > MAX_ATTACHMENTS) {
      error(`${label} has more than ${MAX_ATTACHMENTS} pictures.`, post.source);
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

  const commentsByRef = new Map(study.comments.map((comment) => [comment.ref, comment]));
  for (const comment of study.comments) {
    if (!comment.replyTo) {
      continue;
    }
    const label = `Comment "${comment.ref}"`;
    const parent = commentsByRef.get(comment.replyTo);
    if (!parent) {
      error(`${label} replies to "${comment.replyTo}", which doesn't exist.`, comment.source);
      continue;
    }
    if (parent.post !== comment.post) {
      error(`${label} replies to "${parent.ref}", which is on another post.`, comment.source);
    }
    if (comment.timeMs < parent.timeMs) {
      error(`${label} is timed before the comment it replies to.`, comment.source);
    }
    if (parent.conditions.length > 0) {
      const missing = (comment.conditions.length > 0 ? comment.conditions : [...armKeys]).filter(
        (key) => !parent.conditions.includes(key),
      );
      if (missing.length > 0) {
        warning(
          `${label} won't show in ${missing.join(", ")}, because "${parent.ref}", which it replies to, isn't there.`,
        );
      }
    }
    const seen = new Set([comment.ref]);
    for (
      let above = parent;
      above;
      above = commentsByRef.get(above.replyTo ?? "") as typeof parent
    ) {
      if (seen.has(above.ref)) {
        error(`${label} is part of a circle of replies.`, comment.source);
        break;
      }
      seen.add(above.ref);
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

  const checkLink = (link: string, label: string) => {
    for (const [, name] of link.matchAll(/\{(\w*)\}/g)) {
      if (!LINK_PLACEHOLDERS.includes(name as (typeof LINK_PLACEHOLDERS)[number])) {
        error(
          `${label} uses {${name}}. It can only use ${LINK_PLACEHOLDERS.map((item) => `{${item}}`).join(" and ")}.`,
        );
      }
    }
  };
  for (const step of settings.flow) {
    if (step.step === "exit" && step.redirect) {
      checkLink(step.redirect, "The exit link");
      if (!step.redirect.includes("{externalId}") && !step.redirect.includes("{participantId}")) {
        warning(
          "The exit link doesn't pass on who this is, so survey answers can't be matched to study data. Add {externalId} to it.",
        );
      }
    }
    if (step.step === "consent" && step.declineRedirect) {
      checkLink(step.declineRedirect, "The decline link");
    }
  }

  const usesShuffle = [
    settings.feed.ranker,
    settings.feed.spaceRanker,
    ...settings.conditions.arms.flatMap((arm) => [arm.feed?.ranker, arm.feed?.spaceRanker]),
  ].includes("shuffle");
  const asksReshuffle =
    settings.feed.reshuffleEachVisit ||
    settings.conditions.arms.some((arm) => arm.feed?.reshuffleEachVisit);
  if (asksReshuffle && !usesShuffle) {
    warning("reshuffleEachVisit does nothing unless a condition uses the shuffle ranker.");
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
    [
      ...study.actors,
      ...study.spaces,
      ...study.posts,
      ...study.comments,
      ...study.reactions,
    ].flatMap((item) => item.conditions),
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
