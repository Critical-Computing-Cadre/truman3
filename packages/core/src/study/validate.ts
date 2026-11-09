import { ruleTerms } from "../auto-rules.ts";
import { MAX_ATTACHMENTS } from "../feed.ts";
import { BEATS_FILE, type DecisionDefinition } from "./beats.ts";
import { hasPlaceholderConsent } from "./consent.ts";
import { MAX_LABEL_LENGTH, PARTICIPANT_TAG, type StudyDefinition } from "./definition.ts";
import { LINK_PLACEHOLDERS } from "./links.ts";
import { featuresFor } from "./platform.ts";
import { SCENARIOS_FILE, type ScenarioTarget } from "./scenarios.ts";
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
  if (settings.conditions.arms.every((arm) => arm.weight === 0)) {
    error(
      "At least one condition needs a weight above 0, so people can be assigned when they join.",
    );
  }
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
      shownIn(arm.key, study.removals),
      shownIn(arm.key, study.labels),
      shownIn(arm.key, study.flagAnswers),
      shownIn(arm.key, study.bans),
      shownIn(arm.key, study.reportAnswers),
      shownIn(arm.key, study.autoRules),
      shownIn(arm.key, study.appealAnswers),
      shownIn(arm.key, study.contextNotes),
      shownIn(arm.key, study.stories),
      shownIn(arm.key, study.beats),
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
    const untitled = study.posts.filter((post) => applies(post) && !post.title).length;
    if (on.titles && untitled > 0) {
      warning(`Titles are on in "${arm.key}", but ${untitled} posts don't have one.`);
    }
    const titled = study.posts.filter((post) => applies(post) && post.title).length;
    if (!on.titles && titled > 0) {
      warning(`Titles are off in "${arm.key}", so ${titled} written titles won't show there.`);
    }
    const unused: [boolean, number, string][] = [
      [on.links, study.posts.filter((post) => applies(post) && post.link).length, "Link posts"],
      [
        on.pinning,
        study.posts.filter((post) => applies(post) && post.pinnedOn?.length).length,
        "Pinned posts",
      ],
      [
        on.locking,
        study.posts.filter((post) => applies(post) && post.locked).length,
        "Locked posts",
      ],
      [
        on.spoilers,
        study.posts.filter((post) => applies(post) && post.tags?.includes("spoiler")).length,
        "Spoiler tags",
      ],
      [
        on.adultTags,
        study.posts.filter((post) => applies(post) && post.tags?.includes("adult")).length,
        "Adult content tags",
      ],
      [on.polls, study.posts.filter((post) => applies(post) && post.poll).length, "Polls"],
      [on.flair, study.posts.filter((post) => applies(post) && post.flair).length, "Flair labels"],
      [
        on.crossposting,
        study.posts.filter((post) => applies(post) && post.crosspostOf).length,
        "Crossposts",
      ],
    ];
    for (const [featureIsOn, total, name] of unused) {
      if (!featureIsOn && total > 0) {
        warning(`${name} are off in "${arm.key}", so that won't apply to ${total} posts there.`);
      }
    }
    if (on.crossposting && (!on.posting || !on.spaces)) {
      warning(`Crossposting is on in "${arm.key}", but it needs writing posts and spaces.`);
    }
    const scored = study.actors.filter((actor) => applies(actor) && actor.karma !== undefined);
    if (!on.karma && scored.length > 0) {
      warning(`Karma is off in "${arm.key}", so ${scored.length} written totals won't show there.`);
    }
    const changes = arm.platform?.karmaChanges ?? settings.platform.karmaChanges ?? [];
    if (!on.karma && changes.length > 0) {
      warning(`Karma is off in "${arm.key}", so its scripted changes won't show there.`);
    }
    if (on.postPages && !on.comments) {
      warning(`A page for each post is on in "${arm.key}", but it's for comments, which are off.`);
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
    if (
      !on.removal &&
      (study.removals.some(applies) || reactions.some(({ type }) => type === "remove"))
    ) {
      warning(`Moderators removing things is off in "${arm.key}", so its removals won't happen.`);
    }
    if (
      !on.labels &&
      (study.labels.some(applies) || reactions.some(({ type }) => type === "label"))
    ) {
      warning(`Labels on posts are off in "${arm.key}", so its labels won't show.`);
    }
    if (!on.warnings && reactions.some(({ type }) => type === "warn")) {
      warning(`Moderators warning people is off in "${arm.key}", so its warnings won't happen.`);
    }
    const answers = study.flagAnswers.filter(applies);
    if (answers.length > 0 && (!on.flagAnswers || !on.flagging)) {
      warning(
        `Answering flags needs flagging and the feature on in "${arm.key}", so its answers won't happen.`,
      );
    }
    if (on.flagAnswers && !on.removal && answers.some(({ action }) => action === "remove")) {
      warning(
        `Moderators removing things is off in "${arm.key}", so flags won't lead to removals.`,
      );
    }
    const bans = study.bans.filter(applies);
    const reportAnswers = study.reportAnswers.filter(applies);
    if (!on.bans && (bans.length > 0 || reportAnswers.some(({ action }) => action === "ban"))) {
      warning(`Moderators banning people is off in "${arm.key}", so its bans won't happen.`);
    }
    if (reportAnswers.length > 0 && (!on.reportAnswers || !on.reporting)) {
      warning(
        `Answering reports needs reporting and the feature on in "${arm.key}", so its answers won't happen.`,
      );
    }
    if (on.bans) {
      // Writing past a ban is easy to do by accident, since the feed being edited shows it all.
      const postsByRef = new Map(study.posts.map((post) => [post.ref, post]));
      for (const ban of bans) {
        const hidden = [
          ...study.posts.filter(
            (post) =>
              applies(post) &&
              post.actor === ban.user &&
              post.timeMs >= ban.timeMs &&
              (!ban.space || post.space === ban.space),
          ),
          ...study.comments.filter(
            (comment) =>
              applies(comment) &&
              comment.actor === ban.user &&
              comment.timeMs >= ban.timeMs &&
              (!ban.space || postsByRef.get(comment.post)?.space === ban.space),
          ),
        ].length;
        if (hidden > 0) {
          warning(
            `In "${arm.key}", ${hidden} things written by ${ban.user} come after their ban, so they won't show.`,
          );
        }
      }
    }
    const autoRules = study.autoRules.filter(applies);
    if (!on.autoRules && autoRules.length > 0) {
      warning(`Automatic rules are off in "${arm.key}", so its rules won't happen.`);
    }
    if (on.autoRules && !on.removal && autoRules.some(({ action }) => action === "remove")) {
      warning(
        `Moderators removing things is off in "${arm.key}", so a rule can't remove anything.`,
      );
    }
    if (on.autoRules && !on.warnings && autoRules.some(({ action }) => action === "warn")) {
      warning(`Moderators warning people is off in "${arm.key}", so a rule can't warn anyone.`);
    }
    if (!on.appeals && study.appealAnswers.some(applies)) {
      warning(`Appeals are off in "${arm.key}", so its answers won't happen.`);
    }
    const reposted = study.posts.filter((post) => applies(post) && post.repostOf).length;
    if (!on.reposts && reposted > 0) {
      warning(`Reposts are off in "${arm.key}", so ${reposted} written reposts won't show there.`);
    }
    const quoted = study.posts.filter((post) => applies(post) && post.quoteOf).length;
    if (!on.quotes && quoted > 0) {
      warning(
        `Quote posts are off in "${arm.key}", so ${quoted} won't show what they quote there.`,
      );
    }
    if (!on.reposts && reactions.some(({ type }) => type === "repost")) {
      warning(`Reposts are off in "${arm.key}", so its scripted reposts won't happen.`);
    }
    if (!on.following && reactions.some(({ type }) => type === "follow")) {
      warning(`Following is off in "${arm.key}", so its scripted follows won't happen.`);
    }
    if (on.followingFeed && !on.following) {
      warning(`A following feed is on in "${arm.key}", but following, which it needs, is off.`);
    }
    if (!on.badges && study.actors.some((actor) => applies(actor) && actor.badge)) {
      warning(`Badges are off in "${arm.key}", so the badges you wrote won't show there.`);
    }
    const limit = arm.platform?.maxPostLength ?? settings.platform.maxPostLength;
    if (limit) {
      const over = [...study.posts, ...study.comments].filter(
        (item) => applies(item) && item.body.length > limit,
      ).length;
      if (over > 0) {
        warning(
          `In "${arm.key}", ${over} things you wrote are longer than what participants can write (${limit}).`,
        );
      }
    }
    const adPosts = study.posts.filter((post) => applies(post) && post.ad).length;
    if (!on.ads && adPosts > 0) {
      warning(`Ads are off in "${arm.key}", so ${adPosts} ads won't show there.`);
    }
    if (!on.contextNotes && study.contextNotes.some(applies)) {
      warning(`Context notes are off in "${arm.key}", so its notes won't show there.`);
    }
    if (!on.whoToFollow && study.actors.some((actor) => applies(actor) && actor.suggested)) {
      warning(`Who to follow is off in "${arm.key}", so nobody will be suggested there.`);
    }
    if (on.whoToFollow && !on.following) {
      warning(`Who to follow is on in "${arm.key}", but following, which it needs, is off.`);
    }
    if (!on.stories && study.stories.some(applies)) {
      warning(`Stories are off in "${arm.key}", so its stories won't show there.`);
    }
    const placed = study.posts.filter((post) => applies(post) && post.place).length;
    if (!on.places && placed > 0) {
      warning(`Places are off in "${arm.key}", so ${placed} places on posts won't show there.`);
    }
    const tagging = study.posts.filter((post) => applies(post) && post.tagged?.length).length;
    if (!on.photoTags && tagging > 0) {
      warning(
        `Tagging people is off in "${arm.key}", so tags on ${tagging} posts won't show there.`,
      );
    }
    if (
      on.stories &&
      !on.highlights &&
      study.stories.some((story) => applies(story) && story.highlight)
    ) {
      warning(`Highlights are off in "${arm.key}", so its highlights won't show there.`);
    }
    if (
      on.stories &&
      !on.closeFriends &&
      study.stories.some((story) => applies(story) && story.closeFriends)
    ) {
      warning(
        `Close friends is off in "${arm.key}", so its close-friends stories will show as ordinary ones.`,
      );
    }
    if (on.modLog && !on.removal) {
      warning(`A mod log is on in "${arm.key}", but it lists removals, which are off.`);
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

  const karmaChanges = [
    ...(settings.platform.karmaChanges ?? []),
    ...settings.conditions.arms.flatMap((arm) => arm.platform?.karmaChanges ?? []),
  ];
  for (const { actor } of karmaChanges) {
    if (actor && !usernames.has(actor)) {
      error(`A scripted karma change names "${actor}", who isn't in the list of actors.`);
    }
  }

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
    if (post.poll) {
      const texts = post.poll.options.map(({ text }) => text.toLowerCase());
      if (new Set(texts).size < texts.length) {
        error(`${label} has a poll with the same option twice.`, post.source);
      }
    }
    if (post.flair) {
      const space = post.space ? spacesByKey.get(post.space) : undefined;
      if (!post.space) {
        error(
          `${label} has flair, but flair comes from a space, and it isn't in one.`,
          post.source,
        );
      } else if (space && !space.postFlair?.some(({ text }) => text === post.flair)) {
        error(
          `${label} has the flair "${post.flair}", which "${post.space}" doesn't offer.`,
          post.source,
        );
      }
    } else if (post.space && spacesByKey.get(post.space)?.requirePostFlair) {
      warning(
        `${label} has no flair, though "${post.space}" requires it of what participants write.`,
        post.source,
      );
    }
    if (post.crosspostOf) {
      const original = study.posts.find(({ ref }) => ref === post.crosspostOf);
      if (!original) {
        error(
          `${label} is a crosspost of "${post.crosspostOf}", which doesn't exist.`,
          post.source,
        );
      } else if (original.ref === post.ref) {
        error(`${label} is a crosspost of itself.`, post.source);
      } else if (original.crosspostOf) {
        error(
          `${label} is a crosspost of "${original.ref}", which is a crosspost too. Point it at the first post.`,
          post.source,
        );
      } else {
        if (!post.space) {
          error(`${label} is a crosspost, so it has to be in a space.`, post.source);
        } else if (post.space === original.space) {
          error(`${label} is a crosspost into the space its original is already in.`, post.source);
        }
        if (post.timeMs < original.timeMs) {
          warning(`${label} appears before "${original.ref}", the post it came from.`, post.source);
        }
        if (original.conditions.length > 0) {
          const missing = (post.conditions.length > 0 ? post.conditions : [...armKeys]).filter(
            (key) => !original.conditions.includes(key),
          );
          if (missing.length > 0) {
            warning(
              `${label} says its original isn't available in ${missing.join(", ")}, because "${original.ref}" doesn't show there.`,
              post.source,
            );
          }
        }
      }
    }
    const allPosts = new Map(study.posts.map((item) => [item.ref, item]));
    for (const [word, ref] of [
      ["repost", post.repostOf],
      ["quote", post.quoteOf],
    ] as const) {
      if (!ref) {
        continue;
      }
      const original = allPosts.get(ref);
      if (!original) {
        error(`${label} is a ${word} of "${ref}", which doesn't exist.`, post.source);
      } else if (post.timeMs < original.timeMs) {
        warning(`${label} appears before "${ref}", the post it passes along.`, post.source);
      }
    }
    if (post.repostOf && post.quoteOf) {
      error(`${label} can be a repost or a quote, not both.`, post.source);
    }
    if (post.repostOf && (post.body || post.title || post.pictures.length > 0)) {
      warning(
        `${label} is a repost, so what it says itself won't show. Make it a quote instead.`,
        post.source,
      );
    }
    // A chain has to end somewhere, or nothing could be worked out from it.
    const seen = new Set([post.ref]);
    for (
      let above = allPosts.get(post.repostOf ?? post.quoteOf ?? "");
      above;
      above = allPosts.get(above.repostOf ?? above.quoteOf ?? "")
    ) {
      if (seen.has(above.ref)) {
        error(`${label} is part of a circle of reposts or quotes.`, post.source);
        break;
      }
      seen.add(above.ref);
    }
    if (
      !post.body &&
      post.pictures.length === 0 &&
      !post.title &&
      !post.link &&
      !post.poll &&
      !post.crosspostOf &&
      !post.repostOf
    ) {
      error(`${label} has no text and no picture.`, post.source);
    }
    if (post.pictures.length > MAX_ATTACHMENTS) {
      error(`${label} has more than ${MAX_ATTACHMENTS} pictures.`, post.source);
    }
  }

  for (const space of study.spaces) {
    for (const [list, name] of [
      [space.postFlair, "post"],
      [space.userFlair, "people"],
    ] as const) {
      const texts = (list ?? []).map(({ text }) => text);
      if (new Set(texts).size < texts.length) {
        error(`The space "${space.key}" has the same ${name} flair twice.`, space.source);
      }
    }
    if (space.requirePostFlair && !space.postFlair?.length) {
      error(
        `The space "${space.key}" requires flair on posts, but offers none, so nobody could post there.`,
        space.source,
      );
    }
  }
  for (const actor of study.actors) {
    for (const [key, text] of Object.entries(actor.spaceFlair ?? {})) {
      const space = spacesByKey.get(key);
      if (!space) {
        error(
          `${actor.username} has flair in the space "${key}", which doesn't exist.`,
          actor.source,
        );
      } else if (!space.userFlair?.some((flair) => flair.text === text)) {
        error(
          `${actor.username} has the flair "${text}", which "${key}" doesn't offer.`,
          actor.source,
        );
      }
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
    if (reaction.on === "story" && reaction.type !== "read" && reaction.type !== "like") {
      error(
        `${label} can only be a read or a like, since a story has nothing else.`,
        reaction.source,
      );
    }
    checkActor(reaction.actor, label, reaction.source);
    checkConditions(reaction.conditions, label, reaction.source);
    if (
      (reaction.type === "reply" || reaction.type === "warn" || reaction.type === "label") &&
      !reaction.body
    ) {
      error(`${label} is a ${reaction.type}, but has no text.`, reaction.source);
    }
    if (reaction.type === "label" && (reaction.body ?? "").length > MAX_LABEL_LENGTH) {
      error(`${label} is a label longer than ${MAX_LABEL_LENGTH} characters.`, reaction.source);
    }
    if (
      reaction.type !== "reply" &&
      reaction.type !== "remove" &&
      reaction.type !== "warn" &&
      reaction.type !== "label" &&
      reaction.body
    ) {
      error(`${label} is a ${reaction.type}, so it can't have text.`, reaction.source);
    }
  }

  for (const removal of study.removals) {
    const label = `The removal of ${removal.on} "${removal.target}"`;
    checkActor(removal.actor, label, removal.source);
    checkConditions(removal.conditions, label, removal.source);
    const target =
      removal.on === "post" ? posts.get(removal.target) : commentsByRef.get(removal.target);
    if (!target) {
      error(`${label} points at a ${removal.on} that isn't in this study.`, removal.source);
    } else if (removal.timeMs < target.timeMs) {
      warning(`${label} is set for before it appears, so it will already be removed when it does.`);
    }
  }

  for (const labeling of study.labels) {
    const label = `The "${labeling.label}" label on ${labeling.on} "${labeling.target}"`;
    checkActor(labeling.actor, label, labeling.source);
    checkConditions(labeling.conditions, label, labeling.source);
    const target =
      labeling.on === "post" ? posts.get(labeling.target) : commentsByRef.get(labeling.target);
    if (!target) {
      error(`${label} points at a ${labeling.on} that isn't in this study.`, labeling.source);
    }
  }

  for (const answer of study.flagAnswers) {
    const label = answer.target
      ? `The answer to a flag on "${answer.target}"`
      : "The answer to any flag";
    checkActor(answer.actor, label, answer.source);
    checkConditions(answer.conditions, label, answer.source);
    if (answer.target) {
      const target =
        answer.on === "comment"
          ? commentsByRef.get(answer.target)
          : answer.on === "post"
            ? posts.get(answer.target)
            : undefined;
      if (!target) {
        error(
          `${label} has to say post or comment, and point at one in this study.`,
          answer.source,
        );
      }
    }
    if (answer.action === "answer" && !answer.message) {
      error(`${label} has no message.`, answer.source);
    }
  }

  for (const ban of study.bans) {
    const label = `The ban of "${ban.user}"`;
    checkActor(ban.user, label, ban.source);
    checkActor(ban.actor, label, ban.source);
    checkConditions(ban.conditions, label, ban.source);
    if (ban.space && !spacesByKey.has(ban.space)) {
      error(`${label} names the space "${ban.space}", which isn't in this study.`, ban.source);
    }
  }

  for (const answer of study.reportAnswers) {
    const label = answer.user
      ? `The answer to a report of "${answer.user}"`
      : "The answer to any report";
    if (answer.user) {
      checkActor(answer.user, label, answer.source);
    }
    checkActor(answer.actor, label, answer.source);
    checkConditions(answer.conditions, label, answer.source);
    if (answer.action === "answer" && !answer.message) {
      error(`${label} has no message.`, answer.source);
    }
  }

  const storyRefs = new Set<string>();
  for (const story of study.stories) {
    const label = `The story "${story.ref}"`;
    if (storyRefs.has(story.ref)) {
      error(`${label} has the same ID as another story.`, story.source);
    }
    storyRefs.add(story.ref);
    checkActor(story.actor, label, story.source);
    checkConditions(story.conditions, label, story.source);
    if (!story.picture) {
      error(`${label} has no photo yet.`, story.source);
    }
  }
  for (const post of study.posts) {
    if (post.likedBy) {
      checkActor(post.likedBy, `Post "${post.ref}"'s likedBy`, post.source);
    }
    for (const username of post.tagged ?? []) {
      if (username !== PARTICIPANT_TAG && !usernames.has(username)) {
        error(
          `Post "${post.ref}" tags "${username}", who isn't in the list of actors.`,
          post.source,
        );
      }
    }
  }

  const noteRefs = new Set<string>();
  for (const note of study.contextNotes) {
    const label = `The context note "${note.ref}"`;
    if (noteRefs.has(note.ref)) {
      error(`${label} has the same ID as another note.`, note.source);
    }
    noteRefs.add(note.ref);
    checkConditions(note.conditions, label, note.source);
    const target = posts.get(note.post);
    if (!target) {
      error(`${label} is on "${note.post}", a post that isn't in this study.`, note.source);
    } else if (note.timeMs < target.timeMs) {
      warning(
        `${label} is set for before its post appears, so it'll be there from the start.`,
        note.source,
      );
    }
  }

  const ruleRefs = new Set<string>();
  for (const rule of study.autoRules) {
    const label = `The automatic rule "${rule.ref}"`;
    if (ruleRefs.has(rule.ref)) {
      error(`${label} has the same ID as another rule.`, rule.source);
    }
    ruleRefs.add(rule.ref);
    checkActor(rule.actor, label, rule.source);
    checkConditions(rule.conditions, label, rule.source);
    if (ruleTerms(rule.match).length === 0) {
      error(`${label} has no words to look for.`, rule.source);
    }
    if ((rule.action === "confirm" || rule.action === "warn") && !rule.message) {
      error(`${label} has to say something, since it asks or warns.`, rule.source);
    }
    if (rule.holdOutcome && rule.action !== "hold") {
      error(`${label} says how a hold ends, but it isn't a hold.`, rule.source);
    }
  }
  for (const answer of study.appealAnswers) {
    const label = "An answer to an appeal";
    checkActor(answer.actor, label, answer.source);
    checkConditions(answer.conditions, label, answer.source);
    if (answer.action === "uphold" && !answer.message) {
      error(`${label} keeps the removal, but doesn't say anything.`, answer.source);
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

  // Beats come from beats.yaml, so their problems point at the file and the beat's id.
  const beatProblem = (severity: "error" | "warning", message: string) =>
    issues.push({ severity, message, file: BEATS_FILE });
  const beatIds = new Map<string, StudyDefinition["beats"][number]>();
  for (const beat of study.beats) {
    if (beatIds.has(beat.id)) {
      beatProblem("error", `The beat id "${beat.id}" is used more than once.`);
    }
    beatIds.set(beat.id, beat);
  }
  const decisions = study.christof?.decide ?? [];
  const decisionIds = new Set(decisions.map(({ id }) => id));
  const beatLengthMs = settings.length.days * 24 * HOUR_MS;
  for (const beat of study.beats) {
    const label = `The beat "${beat.id}"`;
    const { when, do: action } = beat;
    if (!usernames.has(action.actor)) {
      beatProblem(
        "error",
        `${label} is done by "${action.actor}", who isn't in the list of actors.`,
      );
    }
    for (const condition of beat.conditions) {
      if (!armKeys.has(condition)) {
        beatProblem(
          "error",
          `${label} uses the condition "${condition}", which isn't in study.yaml.`,
        );
      }
    }
    /** A beat can come after a decision point, or be skipped after one, but not act on one. */
    const checkBeat = (id: string, what: string, decisionAllowed = false) => {
      if (decisionIds.has(id)) {
        if (!decisionAllowed) {
          beatProblem(
            "error",
            `${label} ${what} "${id}", which is a decision point, so it doesn't make anything.`,
          );
        }
      } else if (!beatIds.has(id)) {
        beatProblem("error", `${label} ${what} "${id}", which isn't a beat in this study.`);
      } else if (id === beat.id) {
        beatProblem("error", `${label} ${what} itself.`);
      }
    };
    if ("time" in when && when.time >= beatLengthMs) {
      beatProblem("warning", `${label} is set for after the study ends, so it won't happen.`);
    }
    if ("participant" in when) {
      if (when.on && !usernames.has(when.on)) {
        beatProblem(
          "error",
          `${label} waits for something on "${when.on}", who isn't in the list of actors.`,
        );
      }
      if (when.under) {
        checkBeat(when.under, "waits for something under");
      }
    }
    if ("beat" in when) {
      checkBeat(when.beat, "comes after", true);
    }
    if ("on" in action) {
      const target = action.on;
      if (target === "trigger" && "time" in when) {
        beatProblem(
          "error",
          `${label} acts on what set it off, but a time doesn't point at anything.`,
        );
      } else if (target === "trigger" && "beat" in when && decisionIds.has(when.beat)) {
        beatProblem(
          "error",
          `${label} acts on what set it off, but a decision point doesn't make anything.`,
        );
      } else if (typeof target === "object" && "beat" in target) {
        checkBeat(target.beat, "acts on what was made by");
      } else if (typeof target === "object" && "post" in target && !posts.has(target.post)) {
        beatProblem(
          "error",
          `${label} acts on the post "${target.post}", which isn't in this study.`,
        );
      }
    }
    for (const id of beat.unless) {
      checkBeat(id, "is skipped after", true);
    }
    if (beat.delay.minMs > beat.delay.maxMs) {
      beatProblem("error", `${label} has a delay whose min is after its max.`);
    }
    if (beat.delay.minMs < 0) {
      beatProblem("error", `${label} has a delay before its trigger, which can't happen.`);
    }
    // A beat that can't work where it's used is worth knowing about before launch.
    const needs = {
      comment: "comments",
      like: "likes",
      repost: "reposts",
      follow: "following",
    } as const;
    const feature = action.action === "post" ? "posting" : needs[action.action];
    for (const arm of settings.conditions.arms) {
      const inArm = beat.conditions.length === 0 || beat.conditions.includes(arm.key);
      if (inArm && !featuresFor(settings, arm.key)[feature]) {
        beatProblem(
          "warning",
          `${label} needs ${feature}, which is off in "${arm.key}", so it won't happen there.`,
        );
      }
    }
  }
  // Persona cards and live writing, from the top of beats.yaml.
  const christof = study.christof;
  for (const [username, persona] of Object.entries(christof?.cast ?? {})) {
    if (!usernames.has(username)) {
      beatProblem(
        "error",
        `There's a persona card for "${username}", who isn't in the list of actors.`,
      );
    }
    for (const other of Object.keys(persona.relationships ?? {})) {
      if (other !== "participant" && !usernames.has(other)) {
        beatProblem(
          "warning",
          `${username}'s persona card mentions "${other}", who isn't in the list of actors. Use "participant" for whoever takes part.`,
        );
      }
    }
  }
  // With rehearsed lines, live writing off is a way to run a study: one is drawn for each world.
  const improvised = study.beats.filter(
    (beat) => "improvise" in beat.do && beat.do.improvise && !beat.do.lines?.length,
  );
  if (improvised.length > 0 && !christof?.live.enabled) {
    beatProblem(
      "warning",
      `Live writing is off, so ${improvised.length === 1 ? `the beat "${improvised[0]?.id}" uses its` : `${improvised.length} improvised beats use their`} fallback line. Turn it on with live: { enabled: true } in beats.yaml.`,
    );
  }

  checkDecisions(study, decisions, beatIds, beatLengthMs, usernames, beatProblem);
  checkScenarios(
    study,
    new Set([...beatIds.keys(), ...decisionIds]),
    new Set(posts.keys()),
    usernames,
    (message) => issues.push({ severity: "error", message, file: SCENARIOS_FILE }),
  );

  // One beat following another can't go round in a circle, or it would never stop.
  const followers = new Map<string, { id: string; when: StudyDefinition["beats"][number]["when"] }>(
    [...study.beats, ...decisions].map((item) => [item.id, item]),
  );
  for (const beat of [...study.beats, ...decisions]) {
    const seen = new Set<string>();
    let current: { id: string; when: StudyDefinition["beats"][number]["when"] } | undefined = beat;
    while (current && "beat" in current.when) {
      if (seen.has(current.id)) {
        beatProblem("error", `The beats after "${beat.id}" go round in a circle.`);
        break;
      }
      seen.add(current.id);
      current = followers.get(current.when.beat);
    }
  }

  const targeted = new Set(
    [
      ...study.actors,
      ...study.spaces,
      ...study.posts,
      ...study.comments,
      ...study.reactions,
      ...study.removals,
      ...study.labels,
      ...study.flagAnswers,
      ...study.bans,
      ...study.reportAnswers,
      ...study.autoRules,
      ...study.appealAnswers,
      ...study.contextNotes,
      ...study.stories,
      ...study.beats,
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

/**
 * Decision points, from beats.yaml. People only move forward: to a condition only decisions reach
 * (weight 0), or among the conditions the decision is for. See ADR 55.
 */
function checkDecisions(
  study: StudyDefinition,
  decisions: readonly DecisionDefinition[],
  beatIds: ReadonlyMap<string, unknown>,
  beatLengthMs: number,
  usernames: ReadonlySet<string>,
  problem: (severity: "error" | "warning", message: string) => void,
) {
  const arms = new Map(study.settings.conditions.arms.map((arm) => [arm.key, arm]));
  const reached = new Set<string>();
  const seen = new Set<string>();
  for (const decision of decisions) {
    const label = `The decision point "${decision.id}"`;
    if (beatIds.has(decision.id) || seen.has(decision.id)) {
      problem("error", `The id "${decision.id}" is used more than once.`);
    }
    seen.add(decision.id);
    for (const condition of decision.conditions) {
      if (!arms.has(condition)) {
        problem(
          "error",
          `${label} is for the condition "${condition}", which isn't in study.yaml.`,
        );
      }
    }
    const { when } = decision;
    if ("time" in when && when.time >= beatLengthMs) {
      problem("warning", `${label} is set for after the study ends, so it won't happen.`);
    }
    if ("participant" in when && when.on && !usernames.has(when.on)) {
      problem(
        "error",
        `${label} waits for something on "${when.on}", who isn't in the list of actors.`,
      );
    }
    if ("participant" in when && when.under && !beatIds.has(when.under)) {
      problem("error", `${label} waits for something under "${when.under}", which isn't a beat.`);
    }
    const isBeatOrDecision = (id: string) =>
      beatIds.has(id) || decisions.some((other) => other.id === id);
    if ("beat" in when && (!isBeatOrDecision(when.beat) || when.beat === decision.id)) {
      problem(
        "error",
        `${label} comes after "${when.beat}", which isn't another beat or decision point.`,
      );
    }
    for (const [name, measure] of Object.entries(decision.measure)) {
      if ("fired" in measure && !isBeatOrDecision(measure.fired)) {
        problem("error", `${label} measures ${name} from "${measure.fired}", which isn't a beat.`);
      }
    }
    decision.groups.forEach((group, index) => {
      for (const name of Object.keys(group.if)) {
        if (!(name in decision.measure)) {
          problem(
            "error",
            `${label}'s group "${group.name}" tests ${name}, which isn't in its measure.`,
          );
        }
      }
      if (Object.keys(group.if).length === 0 && index < decision.groups.length - 1) {
        problem(
          "warning",
          `${label}'s group "${group.name}" is for everyone, so the groups after it never happen.`,
        );
      }
      if (group.to === "stay") {
        return;
      }
      for (const key of Object.keys(group.to)) {
        const arm = arms.get(key);
        if (!arm) {
          problem("error", `${label} moves people to "${key}", which isn't in study.yaml.`);
          continue;
        }
        reached.add(key);
        if (arm.weight > 0 && !decision.conditions.includes(key)) {
          problem(
            "error",
            `${label} moves people to "${key}", where people start. Move them only to conditions with weight 0, or among the conditions it's for, so nobody goes back.`,
          );
        }
      }
    });
  }
  for (const arm of study.settings.conditions.arms) {
    if (arm.weight === 0 && !reached.has(arm.key)) {
      problem(
        "warning",
        `The condition "${arm.key}" has weight 0, and no decision point moves anyone there, so nobody will be in it.`,
      );
    }
  }
}

/** Scenario tests, from scenarios.yaml: everything they name has to be in the study. */
function checkScenarios(
  study: StudyDefinition,
  cues: ReadonlySet<string>,
  posts: ReadonlySet<string>,
  usernames: ReadonlySet<string>,
  problem: (message: string) => void,
) {
  const arms = new Set(study.settings.conditions.arms.map(({ key }) => key));
  for (const scenario of study.scenarios) {
    const label = `The scenario "${scenario.name}"`;
    if (!arms.has(scenario.condition)) {
      problem(`${label} starts in "${scenario.condition}", which isn't a condition in study.yaml.`);
    }
    scenario.steps.forEach((step, index) => {
      const where = `${label}, step ${index + 1},`;
      const checkTarget = (target: ScenarioTarget | undefined) => {
        if (target && "post" in target && !posts.has(target.post)) {
          problem(`${where} uses the post "${target.post}", which isn't in this study.`);
        }
        if (target && "beat" in target && !cues.has(target.beat)) {
          problem(`${where} uses what "${target.beat}" made, but there's no beat called that.`);
        }
      };
      checkTarget(step.on);
      checkTarget(step.like);
      checkTarget(step.repost);
      if (step.follow !== undefined && !usernames.has(step.follow)) {
        problem(`${where} follows "${step.follow}", who isn't in the list of actors.`);
      }
      const expected = step.expect;
      for (const id of [...(expected?.happened ?? []), ...(expected?.notHappened ?? [])]) {
        if (!cues.has(id)) {
          problem(`${where} expects "${id}", which isn't a beat or decision point.`);
        }
      }
      if (expected?.condition !== undefined && !arms.has(expected.condition)) {
        problem(
          `${where} expects the condition "${expected.condition}", which isn't in study.yaml.`,
        );
      }
    });
  }
}
