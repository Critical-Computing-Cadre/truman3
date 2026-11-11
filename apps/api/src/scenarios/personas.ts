import {
  type FeatureSet,
  type FeedResponse,
  formatStudyTime,
  type SimulatedPersona,
} from "@truman3/core";
import type { ACTS, Writer } from "@truman3/writer";
import type { Behavior, SimulatedAction, View } from "./simulate.ts";

/**
 * A model playing a persona, as a simulated participant's behavior. At each look at their feed it's
 * shown what they see, numbered, and what they've done so far, and picks one thing to do, or
 * nothing, saying why. Everything goes in a transcript for the researcher to read. See ADR 60.
 */

type FeedPost = FeedResponse["posts"][number];

/** One moment in a persona's run. */
export interface TranscriptEntry {
  /** Milliseconds since they started. */
  at: number;
  /** What others posted or commented that they hadn't seen before. */
  saw: { who: string; text: string }[];
  /** What they did, in plain words, or null for nothing. */
  did: string | null;
  /** Why, in their voice. */
  why: string;
}

export interface Transcript {
  persona: string;
  condition: string;
  entries: TranscriptEntry[];
  /** What the model playing them cost, in US dollars. */
  costUsd: number;
}

/** A run's spending on the model playing personas, shared by all of them, and its cap. */
export interface Budget {
  limitUsd: number;
  spentUsd: number;
}

/** A persona run reached its budget, so it stops. */
export class BudgetSpent extends Error {}

/** The features a persona's choices depend on, in their condition. */
export type PersonaFeatures = Pick<
  FeatureSet,
  "likes" | "votes" | "comments" | "reposts" | "following" | "posting" | "flagging" | "messages"
>;

/** What each choice is, for the model, and whether the study has it. */
function choices(on: PersonaFeatures): { act: (typeof ACTS)[number]; means: string }[] {
  return [
    on.likes && { act: "like" as const, means: "like a post or comment" },
    on.votes && { act: "upvote" as const, means: "vote a post or comment up" },
    on.votes && { act: "downvote" as const, means: "vote a post or comment down" },
    on.comments && {
      act: "comment" as const,
      means: "comment on a post, or reply to a comment, with text",
    },
    on.reposts && { act: "repost" as const, means: "pass a post along to your followers" },
    on.following && { act: "follow" as const, means: "follow the person who wrote something" },
    on.posting && { act: "post" as const, means: "write a post of your own, in text" },
    on.flagging && { act: "flag" as const, means: "report a post or comment to moderators" },
    on.messages && {
      act: "message" as const,
      means:
        "send a direct message, with text, to someone who wrote something, or in a conversation",
    },
  ].filter((choice) => choice !== false);
}

interface Item {
  id: string;
  /** A post or comment in the feed, or a conversation in their messages. */
  kind: "post" | "comment" | "conversation";
  username: string;
  mine: boolean;
}

/** What something says, or that a moderator took it down, since its text isn't sent then. */
const bodyOf = (item: { body: string; removed?: unknown; author: { isViewer: boolean } }) =>
  item.removed && !item.author.isViewer ? "(removed by a moderator)" : item.body;

/**
 * A feed as numbered lines a model can read, and what each number is. Comments are indented under
 * their post, and replies under their comment. Each shows its likes or its score, whichever the
 * study has.
 */
export function describeFeed(
  posts: readonly FeedPost[],
  on: Pick<PersonaFeatures, "likes" | "votes"> = { likes: true, votes: false },
): { text: string; items: Item[] } {
  const items: Item[] = [];
  const lines: string[] = [];
  const name = (author: FeedPost["author"]) =>
    author.isViewer ? "You" : `${author.name} (@${author.username})`;
  const counts = (item: {
    likes: number;
    liked: boolean;
    ups: number;
    downs: number;
    vote: "up" | "down" | null;
  }) =>
    [
      on.likes && `${item.likes} likes${item.liked ? ", you liked it" : ""}`,
      on.votes && `score ${item.ups - item.downs}${item.vote ? `, you voted ${item.vote}` : ""}`,
    ]
      .filter(Boolean)
      .join("; ");
  for (const post of posts) {
    items.push({
      id: post.id,
      kind: "post",
      username: post.author.username,
      mine: post.author.isViewer,
    });
    const passedOn = post.repostedBy ? ` (reposted by ${post.repostedBy.name})` : "";
    const title = post.title ? `${post.title}: ` : "";
    const postCounts = counts(post);
    lines.push(
      `[${items.length}] ${name(post.author)} posted${passedOn}: "${title}${bodyOf(post)}"${postCounts ? ` (${postCounts})` : ""}`,
    );
    for (const comment of post.comments) {
      items.push({
        id: comment.id,
        kind: "comment",
        username: comment.author.username,
        mine: comment.author.isViewer,
      });
      const commentCounts = counts(comment);
      lines.push(
        `${"  ".repeat(comment.depth + 1)}[${items.length}] ${name(comment.author)} ${comment.depth > 0 ? "replied" : "commented"}: "${bodyOf(comment)}"${commentCounts ? ` (${commentCounts})` : ""}`,
      );
    }
  }
  return { text: lines.join("\n") || "(Nothing yet.)", items };
}

/** What they did, in plain words, for the transcript and for their own memory. */
function describeAction(action: SimulatedAction, items: readonly Item[], feed: string): string {
  const quote = (id: string) => {
    const number = items.findIndex((item) => item.id === id) + 1;
    const line = feed.split("\n").find((text) => text.trimStart().startsWith(`[${number}]`));
    return line ? line.trim().replace(/^\[\d+\] /, "") : "something";
  };
  switch (action.do) {
    case "post":
      return `Posted: "${action.text}"`;
    case "follow":
      return `Followed @${action.username}`;
    case "comment":
      return `Commented "${action.text}" on: ${quote(action.on)}`;
    case "message":
      return `Messaged @${action.to}: "${action.text}"`;
    default:
      return `${action.do[0]?.toUpperCase()}${action.do.slice(1)}d: ${quote(action.on)}`;
  }
}

export function personaBehavior({
  persona,
  condition,
  features,
  writer,
  model,
  budget,
}: {
  persona: SimulatedPersona;
  condition: string;
  /** What the study lets them do in their condition. Only these are offered. */
  features: PersonaFeatures;
  writer: Writer;
  model: string;
  budget: Budget;
}): Behavior & { transcript: Transcript } {
  const transcript: Transcript = { persona: persona.id, condition, entries: [], costUsd: 0 };
  const seen = new Set<string>();
  const offered = choices(features);
  const offeredActs = new Set<string>(offered.map(({ act }) => act));
  const system = `You're helping researchers pilot a social media study before real people take part. Play this person, who has joined the study's site:

${persona.about}

Act as they would. Most of the time, people scroll past without doing anything, and that's a fine choice. Stay in character, and write anything they post or comment the way they would, briefly. Give why in their voice, in one sentence.`;

  return {
    transcript,
    next: async ({ at, posts, conversations = [] }: View) => {
      if (budget.spentUsd >= budget.limitUsd) {
        throw new BudgetSpent();
      }
      const { text, items } = describeFeed(posts, features);
      const saw = posts.flatMap((post) =>
        [post, ...post.comments].flatMap((item) =>
          seen.has(item.id) || item.author.isViewer
            ? []
            : [{ who: item.author.name, text: bodyOf(item) }],
        ),
      );
      for (const item of items) {
        seen.add(item.id);
      }
      // Their messages, numbered after the feed, with what's new marked.
      const messageLines: string[] = [];
      for (const conversation of conversations) {
        items.push({
          id: `conversation:${conversation.username}`,
          kind: "conversation",
          username: conversation.username,
          mine: false,
        });
        messageLines.push(
          `[${items.length}] With ${conversation.name} (@${conversation.username})${conversation.unread > 0 ? `, ${conversation.unread} new` : ""}:`,
          ...conversation.messages.map(
            ({ mine, body }) => `    ${mine ? "You" : conversation.name}: "${body}"`,
          ),
        );
        const fresh = conversation.messages.filter(({ mine }) => !mine).slice(-conversation.unread);
        if (conversation.unread > 0) {
          saw.push(...fresh.map(({ body }) => ({ who: conversation.name, text: body })));
        }
      }
      const done = transcript.entries.flatMap(({ did }) => (did ? [did] : [])).slice(-10);
      const prompt = `It's ${formatStudyTime(at)} since you joined.

${done.length > 0 ? `What you've done so far:\n${done.map((line) => `- ${line}`).join("\n")}` : "You haven't done anything yet."}

Your feed now:
${text}
${messageLines.length > 0 ? `\nYour direct messages:\n${messageLines.join("\n")}\n` : ""}
What you can do on this site:
${offered.map(({ act, means }) => `- ${act}: ${means}`).join("\n")}

Choose one of those now, or nothing. For anything done to a post or comment, give its number in item. For follow, give the number of something by the person. For message, give the number of something by the person, or of a conversation. For post, leave item empty. Only comments, posts, and messages need text.`;

      const acted = await writer.act({ model, system, prompt });
      budget.spentUsd += acted.costUsd;
      transcript.costUsd += acted.costUsd;
      const item = acted.item === null ? undefined : items[acted.item - 1];
      const offeredHere = acted.action === "nothing" || offeredActs.has(acted.action);
      const action: SimulatedAction | null = !offeredHere
        ? null
        : acted.action === "post" && acted.text.trim()
          ? { do: "post", text: acted.text.trim() }
          : !item || item.mine
            ? null
            : acted.action === "message"
              ? acted.text.trim()
                ? { do: "message", to: item.username, text: acted.text.trim() }
                : null
              : // Only following and messaging can be about a conversation.
                item.kind === "conversation" && acted.action !== "follow"
                ? null
                : acted.action === "follow"
                  ? { do: "follow", username: item.username }
                  : acted.action === "comment" && acted.text.trim()
                    ? { do: "comment", on: item.id, text: acted.text.trim() }
                    : acted.action === "like" ||
                        acted.action === "flag" ||
                        acted.action === "upvote" ||
                        acted.action === "downvote"
                      ? { do: acted.action, on: item.id }
                      : acted.action === "repost" && item.kind === "post"
                        ? { do: "repost", on: item.id }
                        : null;
      transcript.entries.push({
        at,
        saw,
        did: action ? describeAction(action, items, text) : null,
        why: !offeredHere
          ? `${acted.why} (It chose to ${acted.action}, which this study doesn't have here.)`
          : acted.action !== "nothing" && !action
            ? `${acted.why} (It chose to ${acted.action}, but that couldn't be done to what it picked.)`
            : acted.why,
      });
      return action;
    },
  };
}
