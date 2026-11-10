import { type FeedResponse, formatStudyTime, type SimulatedPersona } from "@truman3/core";
import type { Writer } from "@truman3/writer";
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

interface Item {
  id: string;
  kind: "post" | "comment";
  username: string;
  mine: boolean;
}

/**
 * A feed as numbered lines a model can read, and what each number is. Comments are indented under
 * their post, and replies under their comment.
 */
export function describeFeed(posts: readonly FeedPost[]): { text: string; items: Item[] } {
  const items: Item[] = [];
  const lines: string[] = [];
  const name = (author: FeedPost["author"]) =>
    author.isViewer ? "You" : `${author.name} (@${author.username})`;
  for (const post of posts) {
    items.push({
      id: post.id,
      kind: "post",
      username: post.author.username,
      mine: post.author.isViewer,
    });
    const passedOn = post.repostedBy ? ` (reposted by ${post.repostedBy.name})` : "";
    const title = post.title ? `${post.title}: ` : "";
    lines.push(
      `[${items.length}] ${name(post.author)} posted${passedOn}: "${title}${post.body}" (${post.likes} likes${post.liked ? ", you liked it" : ""})`,
    );
    for (const comment of post.comments) {
      items.push({
        id: comment.id,
        kind: "comment",
        username: comment.author.username,
        mine: comment.author.isViewer,
      });
      lines.push(
        `${"  ".repeat(comment.depth + 1)}[${items.length}] ${name(comment.author)} ${comment.depth > 0 ? "replied" : "commented"}: "${comment.body}"${comment.liked ? " (you liked it)" : ""}`,
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
    default:
      return `${action.do[0]?.toUpperCase()}${action.do.slice(1)}d: ${quote(action.on)}`;
  }
}

export function personaBehavior({
  persona,
  condition,
  writer,
  model,
  budget,
}: {
  persona: SimulatedPersona;
  condition: string;
  writer: Writer;
  model: string;
  budget: Budget;
}): Behavior & { transcript: Transcript } {
  const transcript: Transcript = { persona: persona.id, condition, entries: [], costUsd: 0 };
  const seen = new Set<string>();
  const system = `You're helping researchers pilot a social media study before real people take part. Play this person, who has joined the study's site:

${persona.about}

Act as they would. Most of the time, people scroll past without doing anything, and that's a fine choice. Stay in character, and write anything they post or comment the way they would, briefly. Give why in their voice, in one sentence.`;

  return {
    transcript,
    next: async ({ at, posts }: View) => {
      if (budget.spentUsd >= budget.limitUsd) {
        throw new BudgetSpent();
      }
      const { text, items } = describeFeed(posts);
      const saw = posts.flatMap((post) =>
        [post, ...post.comments].flatMap((item) =>
          seen.has(item.id) || item.author.isViewer
            ? []
            : [{ who: item.author.name, text: item.body }],
        ),
      );
      for (const item of items) {
        seen.add(item.id);
      }
      const done = transcript.entries.flatMap(({ did }) => (did ? [did] : [])).slice(-10);
      const prompt = `It's ${formatStudyTime(at)} since you joined.

${done.length > 0 ? `What you've done so far:\n${done.map((line) => `- ${line}`).join("\n")}` : "You haven't done anything yet."}

Your feed now:
${text}

Choose one thing to do now, or nothing. For like, comment, repost, or flag, give the number of the post or comment in item. A comment on a comment is a reply to it. For follow, give the number of something by the person. For post, write it in text, with item empty. Only comments and posts need text.`;

      const acted = await writer.act({ model, system, prompt });
      budget.spentUsd += acted.costUsd;
      transcript.costUsd += acted.costUsd;
      const item = acted.item === null ? undefined : items[acted.item - 1];
      const action: SimulatedAction | null =
        acted.action === "post" && acted.text.trim()
          ? { do: "post", text: acted.text.trim() }
          : !item || item.mine
            ? null
            : acted.action === "follow"
              ? { do: "follow", username: item.username }
              : acted.action === "comment" && acted.text.trim()
                ? { do: "comment", on: item.id, text: acted.text.trim() }
                : acted.action === "like" || acted.action === "flag"
                  ? { do: acted.action, on: item.id }
                  : acted.action === "repost" && item.kind === "post"
                    ? { do: "repost", on: item.id }
                    : null;
      transcript.entries.push({
        at,
        saw,
        did: action ? describeAction(action, items, text) : null,
        why:
          acted.action !== "nothing" && !action
            ? `${acted.why} (It chose to ${acted.action}, but that couldn't be done to what it picked.)`
            : acted.why,
      });
      return action;
    },
  };
}
