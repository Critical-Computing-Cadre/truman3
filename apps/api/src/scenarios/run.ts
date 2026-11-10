import { randomUUID } from "node:crypto";
import { formatStudyTime, type Scenario, type ScenarioTarget } from "@truman3/core";
import { type Database, schema } from "@truman3/db";
import type { Storage } from "@truman3/storage";
import { deleteParticipant } from "@truman3/study-import";
import type { Writer } from "@truman3/writer";
import { and, desc, eq, isNull } from "drizzle-orm";
import { scriptFor } from "../director/director.ts";
import { bodiesIn, createHarness } from "./harness.ts";

/**
 * Runs a study's scenario tests. Each scenario is a test participant, started as a researcher's
 * "Try it" starts one, in the condition it names. Their world runs on a clock the runner moves forward, so
 * a day takes a moment. Everything they do goes through the API, the same as a real participant.
 * See ADR 56.
 */

export interface ScenarioResult {
  name: string;
  passed: boolean;
  /** What wasn't as expected, or couldn't be done, in plain words, with when. */
  problems: string[];
}

export interface RunScenariosOptions {
  db: Database;
  storage: Storage;
  versionId: string;
  scenarios: readonly Scenario[];
  /** What writes improvised lines. Leave out to use fallback and rehearsed lines. */
  writer?: Writer | null;
  /**
   * Whether to delete each test participant after their scenario. On a real server their world
   * runs ahead of the real time, so it shouldn't stay where researchers look.
   */
  cleanUp?: boolean;
}

export async function runScenarios({
  db,
  storage,
  versionId,
  scenarios,
  writer = null,
  cleanUp = false,
}: RunScenariosOptions): Promise<ScenarioResult[]> {
  const harness = createHarness({ db, storage, versionId, writer });
  const script = await scriptFor(db, versionId);
  const cues = [...script.beats, ...script.decide];
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    const problems: string[] = [];
    const start = new Date();
    harness.setNow(start);
    const participant = await harness.start(scenario.condition);
    if (!participant) {
      results.push({
        name: scenario.name,
        passed: false,
        problems: [`They couldn't start in "${scenario.condition}".`],
      });
      continue;
    }
    const { participantId, worldId } = participant;
    const send = participant.send;
    const currentCondition = participant.condition;
    const meta = () => ({
      clientEventId: randomUUID(),
      occurredAt: harness.now().toISOString(),
    });
    const target = async (on: ScenarioTarget): Promise<string | null> => {
      if ("post" in on) {
        const [post] = await db
          .select({ id: schema.content.id })
          .from(schema.content)
          .where(
            and(
              eq(schema.content.studyVersionId, versionId),
              eq(schema.content.sourceRef, on.post),
              isNull(schema.content.worldId),
            ),
          );
        return post?.id ?? null;
      }
      const [run] = await db
        .select({ contentId: schema.beatRuns.contentId })
        .from(schema.beatRuns)
        .where(
          and(
            eq(schema.beatRuns.worldId, worldId),
            eq(schema.beatRuns.beat, on.beat),
            eq(schema.beatRuns.status, "fired"),
          ),
        )
        .orderBy(desc(schema.beatRuns.dueAt))
        .limit(1);
      return run?.contentId ?? null;
    };
    const describe = (on: ScenarioTarget) =>
      "post" in on ? `the post "${on.post}"` : `what "${on.beat}" made`;

    const steps = [...scenario.steps].sort((a, b) => a.at - b.at);
    for (const step of steps) {
      harness.setNow(new Date(start.getTime() + step.at));
      const when = `At ${formatStudyTime(step.at)}`;
      // Loading anything lets Christof catch up, as it would when a real participant comes back.
      await send("GET", "/me");

      let done: { ok: boolean; json: Record<string, unknown> } | null = null;
      if (step.post !== undefined) {
        const form = new FormData();
        for (const [key, value] of Object.entries({ ...meta(), body: step.post })) {
          form.set(key, value);
        }
        done = await send("POST", "/posts", form);
      } else if (step.follow !== undefined) {
        done = await send("POST", `/actors/${step.follow}/relation`, {
          ...meta(),
          action: "follow",
        });
      } else if (step.expect === undefined) {
        const on = (step.on ?? step.like ?? step.repost) as ScenarioTarget;
        const id = await target(on);
        if (!id) {
          problems.push(`${when}, there was nothing yet for ${describe(on)}.`);
          continue;
        }
        done =
          step.comment !== undefined
            ? await send("POST", `/content/${id}/comments`, {
                ...meta(),
                body: step.comment,
              })
            : await send("POST", `/content/${id}/${step.like ? "like" : "repost"}`, {
                ...meta(),
                active: true,
              });
      }
      if (done && !done.ok) {
        problems.push(`${when}, they couldn't do it: ${String(done.json.error ?? "it failed")}`);
      }
      if (done) {
        // What they did can set beats off, and those might need a model, as a background check does.
        await send("GET", "/me");
        continue;
      }

      const expect = step.expect;
      if (!expect) {
        continue;
      }
      const runs = await db
        .select()
        .from(schema.beatRuns)
        .where(eq(schema.beatRuns.worldId, worldId));
      const at = (date: Date) => formatStudyTime(date.getTime() - start.getTime());
      for (const id of expect.happened) {
        const mine = runs.filter((run) => run.beat === id);
        if (mine.some((run) => run.status === "fired")) {
          continue;
        }
        const latest = mine.at(-1);
        const cue = cues.find((item) => item.id === id);
        const condition = await currentCondition();
        const why = !latest
          ? cue && cue.conditions.length > 0 && !cue.conditions.includes(condition ?? "")
            ? `it's only in ${cue.conditions.map((key) => `"${key}"`).join(" or ")}, and they're in "${condition}"`
            : cue && "time" in cue.when && cue.when.time > step.at
              ? `it's set for ${formatStudyTime(cue.when.time)}`
              : "nothing set it off"
          : latest.status === "pending"
            ? `it's due at ${at(latest.dueAt)}`
            : latest.status === "awaiting"
              ? "it's waiting for a researcher to approve it"
              : `it was skipped: ${latest.reason ?? "no reason recorded"}`;
        problems.push(`${when}, "${id}" should have happened, but ${why}.`);
      }
      for (const id of expect.notHappened) {
        const fired = runs.find((run) => run.beat === id && run.status === "fired");
        if (fired) {
          problems.push(
            `${when}, "${id}" shouldn't have happened, but it did at ${at(fired.dueAt)}.`,
          );
        }
      }
      if (expect.condition !== undefined) {
        const condition = await currentCondition();
        if (condition !== expect.condition) {
          problems.push(
            `${when}, they should be in "${expect.condition}", but they're in "${condition}".`,
          );
        }
      }
      if (expect.sees.length > 0 || expect.doesNotSee.length > 0) {
        const feed = await send("GET", "/feed");
        const texts = bodiesIn(feed.json);
        // Some platforms show comments only on a post's own page, so open the ones that have them.
        const posts = (feed.json.posts ?? []) as {
          id: string;
          comments: unknown[];
          commentCount: number;
        }[];
        for (const post of posts) {
          if (post.commentCount > post.comments.length) {
            const opened = await send("GET", `/feed?surface=post&post=${post.id}`);
            texts.push(...bodiesIn(opened.json));
          }
        }
        for (const text of expect.sees) {
          if (!texts.some((body) => body.includes(text))) {
            problems.push(`${when}, they should see "${text}", but they don't.`);
          }
        }
        for (const text of expect.doesNotSee) {
          if (texts.some((body) => body.includes(text))) {
            problems.push(`${when}, they shouldn't see "${text}", but they do.`);
          }
        }
      }
    }
    results.push({ name: scenario.name, passed: problems.length === 0, problems });
    if (cleanUp) {
      await deleteParticipant(db, storage, participantId, "scenario test", "Truman");
    }
  }
  return results;
}
