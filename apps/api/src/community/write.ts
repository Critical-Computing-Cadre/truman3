import type { CommunityBrief, Persona } from "@truman3/core";
import type { Writer } from "@truman3/writer";

// Writing one day of a community: the same for one drafted ahead (ADR 99) and one written while
// the study runs (ADR 102).

export interface WrittenReply {
  actor: string;
  body: string;
  /** Minutes after the post. */
  minutesAfter: number;
  /** The reply this answers, by its place among this post's replies from 0, or null for the post. */
  replyTo: number | null;
}

export interface WrittenPost {
  actor: string;
  /** Empty where posts have no titles. */
  title: string;
  body: string;
  /** Minutes into the day, from 0 to 1439. */
  minute: number;
  likes: number;
  replies: WrittenReply[];
}

/** Something someone in the cast says under one of the participant's own posts (ADR 103). */
export interface WrittenAnswer {
  /** The participant's post, by its content ID. */
  to: string;
  actor: string;
  body: string;
  /** Minutes into the day, from 0 to 1439. */
  minute: number;
}

/** What a participant has posted, for the model writing their own community. */
export interface ParticipantPosts {
  username: string;
  /** Posts nobody in the cast has answered yet, which can be answered today. */
  unanswered: { id: string; body: string }[];
  /** The rest, for what they've been talking about. */
  answered: string[];
}

export interface CastMember {
  username: string;
  name: string;
  bio: string;
}

function personaLines({ username, name, bio }: CastMember, persona?: Persona) {
  return [
    `- ${name || username} (@${username})${bio ? `: ${bio}` : ""}`,
    persona?.about && `  About them: ${persona.about}`,
    persona?.voice && `  How they write: ${persona.voice}`,
    persona?.values && `  What they care about: ${persona.values}`,
    persona?.goals && `  What they want: ${persona.goals}`,
    persona?.relationships &&
      Object.keys(persona.relationships).length > 0 &&
      `  How they feel about others: ${Object.entries(persona.relationships)
        .filter(([who]) => who !== "participant")
        .map(([who, feeling]) => `@${who}: ${feeling}`)
        .join("; ")}`,
  ].filter(Boolean) as string[];
}

/** The community, its people, and its limits: the same for every day. */
export function communitySystem({
  site,
  brief,
  inThisVersion,
  cast,
  personas,
  maxLength,
  titles,
  limits,
}: {
  /** What kind of site it's on. */
  site: string;
  brief: Pick<CommunityBrief, "about" | "topics">;
  /** What's different in this condition's community, if each has its own. */
  inThisVersion: string;
  cast: readonly CastMember[];
  personas: Record<string, Persona>;
  maxLength: number;
  titles: boolean;
  limits: readonly string[];
}) {
  return [
    `You write a whole online community for a social media research study: posts, and replies between the people in it. It's on a site like this: ${site}`,
    `The community: ${brief.about}`,
    inThisVersion && `In this version of it: ${inThisVersion}`,
    brief.topics.length > 0 &&
      `What people here talk about, roughly in order of how often:\n${brief.topics.map((topic) => `- ${topic}`).join("\n")}`,
    `The people in it. Only they may post or reply, by their username:\n${cast
      .flatMap((member) => personaLines(member, personas[member.username]))
      .join("\n")}`,
    `Write the way people really write on a site like this: some short, some longer, casual, with their own habits. People have their own interests, agree and disagree, and answer each other by name sometimes. Not everyone posts every day. Keep each post and reply under ${maxLength} characters.${titles ? " Every post has a short title." : " Leave titles empty."}`,
    `Never write any of these:\n${limits.map((limit) => `- ${limit}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** One day: which it is, what's come before, and how much to write. */
export function dayPrompt(
  brief: Pick<CommunityBrief, "postsPerDay" | "repliesPerPost">,
  day: number,
  earlier: readonly string[],
  participant?: ParticipantPosts,
) {
  const theirs = participant
    ? [
        `This community is this one participant's own. They're a real person taking part in the study, and they post as @${participant.username}. Only write for the cast, never for them. People in the cast may mention them by name where it's natural, and shouldn't crowd them.`,
        participant.answered.length > 0 &&
          `What they've posted before:\n${participant.answered.map((body) => `- ${body.slice(0, 300)}`).join("\n")}`,
        participant.unanswered.length > 0
          ? `Their posts nobody has answered yet, by number:\n${participant.unanswered.map(({ body }, index) => `${index}. ${body.slice(0, 500)}`).join("\n")}\nIn "answers", have one or two people in the cast reply to some of these, as they would to anyone in the community: "to" is the post's number, and "minute" is minutes into this day. Not every post needs an answer.`
          : `They haven't posted anything new. Leave "answers" empty.`,
      ]
    : [`Leave "answers" empty.`];
  return [
    `Day ${day + 1 > 0 ? day + 1 : day}${day < 0 ? `, ${-day} ${day === -1 ? "day" : "days"} before the participant arrives` : day === 0 ? ", the day the participant arrives" : ", while the participant is there"}.`,
    earlier.length > 0 &&
      `What's been posted so far, most recent last:\n${earlier.slice(-40).join("\n")}`,
    ...theirs,
    `Write about ${brief.postsPerDay} posts for this day, spread through it, by different people. Give each up to ${brief.repliesPerPost} replies from others, some answering each other. Carry on from what's come before where it makes sense. Each post's minute is minutes into the day, from 0 to 1439, and each reply's minutesAfter is how long after the post it came. Give each post a believable number of likes.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** A post as later days are told about it. */
export const earlierLine = (post: Pick<WrittenPost, "actor" | "title" | "body">) =>
  `@${post.actor}: ${post.title ? `${post.title}: ` : ""}${post.body.slice(0, 200)}`;

/**
 * Asks for a day, checks every line of it in one go, and leaves out what fails, what's by someone
 * outside the cast, and any reply to something left out.
 */
export async function writeCheckedDay(
  model: Writer,
  {
    modelName,
    system,
    prompt,
    cast,
    maxLength,
    titles,
    limits,
    answerable = [],
  }: {
    /** The participant's posts the prompt lists for answering, in the order it numbers them. */
    answerable?: readonly string[];
    modelName: string;
    system: string;
    prompt: string;
    cast: readonly string[];
    maxLength: number;
    titles: boolean;
    limits: readonly string[];
  },
) {
  const written = await model.community({
    model: modelName,
    system,
    prompt,
    cast: [...cast],
    maxLength,
    ...(answerable.length > 0 ? { answering: answerable.length } : {}),
  });
  const lines = [
    ...written.posts.flatMap((post) => [
      `${post.title} ${post.body}`.trim(),
      ...post.replies.map(({ body }) => body),
    ]),
    ...written.answers.map(({ body }) => body),
  ];
  const checked = await model.checkAll(lines, limits, modelName);
  const posts: WrittenPost[] = [];
  let dropped = 0;
  let at = 0;
  for (const post of written.posts) {
    const ok = checked.results[at]?.allowed ?? false;
    at += 1;
    const replyOk = post.replies.map(() => {
      const allowed = checked.results[at]?.allowed ?? false;
      at += 1;
      return allowed;
    });
    if (!ok || !cast.includes(post.actor)) {
      dropped += 1 + post.replies.length;
      continue;
    }
    // Where each reply ended up among those kept, or null if it was left out.
    const places: (number | null)[] = [];
    const replies: WrittenReply[] = [];
    for (const [index, reply] of post.replies.entries()) {
      const parent = reply.replyTo === null ? null : places[reply.replyTo];
      if (
        !replyOk[index] ||
        !cast.includes(reply.actor) ||
        parent === undefined ||
        (reply.replyTo !== null && parent === null)
      ) {
        dropped += 1;
        places.push(null);
        continue;
      }
      places.push(replies.length);
      replies.push({
        actor: reply.actor,
        body: reply.body,
        minutesAfter: reply.minutesAfter,
        replyTo: parent,
      });
    }
    posts.push({
      actor: post.actor,
      title: titles ? post.title : "",
      body: post.body,
      minute: post.minute,
      likes: post.likes,
      replies,
    });
  }
  const answers: WrittenAnswer[] = [];
  for (const answer of written.answers) {
    const ok = checked.results[at]?.allowed ?? false;
    at += 1;
    const to = answerable[answer.to];
    if (!ok || !to || !cast.includes(answer.actor)) {
      dropped += 1;
      continue;
    }
    answers.push({ to, actor: answer.actor, body: answer.body, minute: answer.minute });
  }
  return {
    posts,
    answers,
    dropped,
    costUsd: written.costUsd + checked.costUsd,
    model: written.model,
  };
}
