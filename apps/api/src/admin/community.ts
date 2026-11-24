import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { roleOnStudy } from "@truman3/accounts";
import { BEATS_FILE, featuresFor, type Persona, TEMPLATES } from "@truman3/core";
import { type Database, schema } from "@truman3/db";
import { type ActorData, createItem, deleteItem, loadDraft } from "@truman3/drafts";
import { parseBeats } from "@truman3/study-files";
import { ALWAYS_OFF_LIMITS, NothingWritten, type Writer } from "@truman3/writer";
import { and, desc, eq } from "drizzle-orm";
import { whyNoModel, writerFor } from "../ai.ts";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import { researcherFromRequest } from "./session.ts";

/** A run not heard from in this long has died with its server, and another can start. */
const STALE_MS = 20 * 60 * 1000;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const requestSchema = z.strictObject({
  /** What the community is, and what it's like. */
  about: z.string().trim().min(20).max(3000),
  topics: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  postsPerDay: z.number().int().min(1).max(30),
  /** The most replies a post gets. */
  repliesPerPost: z.number().int().min(0).max(10),
  /** Days of history before a participant arrives. */
  daysBefore: z.number().int().min(0).max(14),
  /** Days while they're there. */
  daysDuring: z.number().int().min(0).max(30),
  /** Who takes part, by username. Empty means everyone in the cast. */
  cast: z.array(z.string()).default([]),
  /** What must never be said, beyond Truman's own limits. */
  neverSay: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
  /** One community for every condition, or each condition its own, with what makes it different. */
  conditions: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("same") }),
    z.strictObject({
      mode: z.literal("each"),
      about: z.record(z.string(), z.string().trim().max(2000)),
    }),
  ]),
});
type CommunityRequest = z.infer<typeof requestSchema>;

interface Progress {
  days: number;
  of: number;
  posts: number;
  replies: number;
  /** Lines the check left out. */
  dropped: number;
}

const runSchema = z.object({
  id: z.string(),
  status: z.enum(["running", "done", "error"]),
  request: z.any(),
  progress: z.object({
    days: z.number(),
    of: z.number(),
    posts: z.number(),
    replies: z.number(),
    dropped: z.number(),
  }),
  costUsd: z.number(),
  model: z.string(),
  error: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});

const params = z.object({ draftId: z.uuid() });
const errorBody = { "application/json": { schema: z.object({ error: z.string() }) } };

const stateRoute = createRoute({
  method: "get",
  path: "/admin/drafts/{draftId}/community",
  summary: "The latest community drafted for this draft, and how far it's got",
  request: { params },
  responses: {
    200: {
      description: "The latest run, or null if there's been none",
      content: { "application/json": { schema: z.object({ run: runSchema.nullable() }) } },
    },
    401: { description: "Not signed in", content: errorBody },
    404: { description: "No such draft", content: errorBody },
  },
});

const startRoute = createRoute({
  method: "post",
  path: "/admin/drafts/{draftId}/community",
  summary: "Draft a community: posts and replies by the cast, for a researcher to review",
  request: {
    params,
    body: { required: true, content: { "application/json": { schema: requestSchema } } },
  },
  responses: {
    202: {
      description: "Started. It works in the background; check back for how far it's got",
      content: { "application/json": { schema: z.object({ id: z.string() }) } },
    },
    400: { description: "Something about the request", content: errorBody },
    401: { description: "Not signed in", content: errorBody },
    403: { description: "Viewers can't", content: errorBody },
    404: { description: "No such draft", content: errorBody },
    409: { description: "One is already running, or there's no model", content: errorBody },
  },
});

const removeRoute = createRoute({
  method: "delete",
  path: "/admin/drafts/{draftId}/community/{runId}",
  summary: "Take out everything a community run wrote, and nothing else",
  request: { params: params.extend({ runId: z.uuid() }) },
  responses: {
    200: {
      description: "Removed",
      content: { "application/json": { schema: z.object({ removed: z.number() }) } },
    },
    401: { description: "Not signed in", content: errorBody },
    403: { description: "Viewers can't", content: errorBody },
    404: { description: "No such run", content: errorBody },
  },
});

function personaLines(username: string, name: string, bio: string, persona?: Persona) {
  return [
    `- ${name} (@${username})${bio ? `: ${bio}` : ""}`,
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

/**
 * Writes a community a day at a time, in the background, as ordinary draft posts and comments.
 * Every line is checked, and what fails is left out. Each day knows what came before, so the
 * community carries on (ADR 99).
 */
async function draftCommunity({
  db,
  writer,
  runId,
  draftId,
  researcherId,
  request,
}: {
  db: Database;
  writer: Writer;
  runId: string;
  draftId: string;
  researcherId: string;
  request: CommunityRequest;
}) {
  const progress: Progress = { days: 0, of: 0, posts: 0, replies: 0, dropped: 0 };
  let costUsd = 0;
  const record = (values: Partial<typeof schema.communityRuns.$inferInsert>) =>
    db
      .update(schema.communityRuns)
      .set({ progress, costUsd, ...values })
      .where(eq(schema.communityRuns.id, runId));
  try {
    const loaded = await loadDraft(db, draftId);
    if (!loaded) {
      throw new Error("The draft is gone.");
    }
    const script = parseBeats(loaded.pages[BEATS_FILE] ?? "");
    const actors = loaded.items
      .filter(({ kind }) => kind === "actor")
      .map(({ id, data }) => ({ id, ...(data as ActorData) }));
    const cast = actors.filter(
      ({ username }) => request.cast.length === 0 || request.cast.includes(username),
    );
    if (cast.length < 2) {
      throw new Error("A community needs at least two people in the cast.");
    }
    const byUsername = new Map(cast.map((actor) => [actor.username, actor]));
    const { settings } = loaded;
    const template = TEMPLATES[settings.platform.template ?? "classic"];
    const arms = settings.conditions.arms.map(({ key }) => key);
    const targets: { conditions: string[]; about: string }[] =
      request.conditions.mode === "same"
        ? [{ conditions: [], about: "" }]
        : arms.map((key) => ({
            conditions: [key],
            about: request.conditions.mode === "each" ? (request.conditions.about[key] ?? "") : "",
          }));
    const days = Array.from(
      { length: request.daysBefore + request.daysDuring },
      (_, index) => index - request.daysBefore,
    );
    progress.of = days.length * targets.length;
    const maxLength = settings.platform.maxPostLength ?? 1000;
    const limits = [...ALWAYS_OFF_LIMITS, ...script.live.redLines, ...request.neverSay];
    const model = (await writerFor(writer, { draftId })) as Writer;
    const provenance = {
      origin: "generated" as const,
      detail: { by: "community", run: runId, model: script.live.model },
    };
    const short = runId.slice(-6);

    for (const target of targets) {
      const titles = (target.conditions.length > 0 ? target.conditions : arms).some(
        (key) => featuresFor(settings, key).titles,
      );
      const system = [
        `You write a whole online community for a social media research study: posts, and replies between the people in it. It's on a site like this: ${template.about}`,
        `The community: ${request.about}`,
        target.about && `In this version of it: ${target.about}`,
        request.topics.length > 0 &&
          `What people here talk about, roughly in order of how often:\n${request.topics.map((topic) => `- ${topic}`).join("\n")}`,
        `The people in it. Only they may post or reply, by their username:\n${cast
          .flatMap(({ username, name, bio }) =>
            personaLines(username, name, bio ?? "", script.cast[username]),
          )
          .join("\n")}`,
        `Write the way people really write on a site like this: some short, some longer, casual, with their own habits. People have their own interests, agree and disagree, and answer each other by name sometimes. Not everyone posts every day. Keep each post and reply under ${maxLength} characters.${titles ? " Every post has a short title." : " Leave titles empty."}`,
        `Never write any of these:\n${limits.map((limit) => `- ${limit}`).join("\n")}`,
      ]
        .filter(Boolean)
        .join("\n\n");
      const earlier: string[] = [];

      for (const day of days) {
        const prompt = [
          `Day ${day + 1 > 0 ? day + 1 : day}${day < 0 ? `, ${-day} ${day === -1 ? "day" : "days"} before the participant arrives` : day === 0 ? ", the day the participant arrives" : ", while the participant is there"}.`,
          earlier.length > 0 &&
            `What's been posted so far, most recent last:\n${earlier.slice(-40).join("\n")}`,
          `Write about ${request.postsPerDay} posts for this day, spread through it, by different people. Give each up to ${request.repliesPerPost} replies from others, some answering each other. Carry on from what's come before where it makes sense. Each post's minute is minutes into the day, from 0 to 1439, and each reply's minutesAfter is how long after the post it came. Give each post a believable number of likes.`,
        ]
          .filter(Boolean)
          .join("\n\n");
        const written = await model.community({
          model: script.live.model,
          system,
          prompt,
          cast: cast.map(({ username }) => username),
          maxLength,
        });
        costUsd += written.costUsd;

        // Check everything written today in one go, and leave out what fails.
        const lines = written.posts.flatMap((post) => [
          `${post.title} ${post.body}`.trim(),
          ...post.replies.map(({ body }) => body),
        ]);
        const checked = await model.checkAll(lines, limits, script.live.model);
        costUsd += checked.costUsd;
        let at = 0;
        for (const [index, post] of written.posts.entries()) {
          const ok = checked.results[at]?.allowed ?? false;
          at += 1;
          const replyOk = post.replies.map(() => {
            const allowed = checked.results[at]?.allowed ?? false;
            at += 1;
            return allowed;
          });
          const author = byUsername.get(post.actor);
          if (!ok || !author) {
            progress.dropped += 1 + post.replies.length;
            continue;
          }
          const timeMs = day * DAY + post.minute * MINUTE;
          const made = await createItem(
            db,
            draftId,
            researcherId,
            "post",
            {
              ref: `community-${short}-${target.conditions[0] ?? "all"}-d${day}-p${index}`,
              body: post.body,
              ...(titles && post.title ? { title: post.title } : {}),
              actorId: author.id,
              timeMs,
              likes: post.likes,
              conditions: target.conditions,
            },
            provenance,
          );
          if ("problem" in made) {
            progress.dropped += 1 + post.replies.length;
            continue;
          }
          progress.posts += 1;
          earlier.push(
            `@${post.actor}: ${titles && post.title ? `${post.title}: ` : ""}${post.body.slice(0, 200)}`,
          );
          const replyIds: (string | null)[] = [];
          for (const [r, reply] of post.replies.entries()) {
            const replier = byUsername.get(reply.actor);
            const parent = reply.replyTo === null ? null : replyIds[reply.replyTo];
            // A reply to one that was left out is left out too.
            if (
              !replyOk[r] ||
              !replier ||
              parent === undefined ||
              (reply.replyTo !== null && !parent)
            ) {
              progress.dropped += 1;
              replyIds.push(null);
              continue;
            }
            const comment = await createItem(
              db,
              draftId,
              researcherId,
              "comment",
              {
                ref: `community-${short}-${target.conditions[0] ?? "all"}-d${day}-p${index}-r${r}`,
                body: reply.body,
                actorId: replier.id,
                postId: made.id,
                ...(parent ? { replyToId: parent } : {}),
                timeMs: timeMs + reply.minutesAfter * MINUTE,
                likes: 0,
                conditions: target.conditions,
              },
              provenance,
            );
            if ("problem" in comment) {
              progress.dropped += 1;
              replyIds.push(null);
              continue;
            }
            progress.replies += 1;
            replyIds.push(comment.id);
          }
        }
        progress.days += 1;
        await record({ model: written.model });
      }
    }
    await record({ status: "done", finishedAt: new Date() });
  } catch (error) {
    const message =
      error instanceof NothingWritten || error instanceof Error
        ? error.message
        : "Something went wrong.";
    console.error("A community run failed:", message);
    await record({ status: "error", error: message, finishedAt: new Date() });
  }
}

export function createCommunityRoutes({ db, writer }: ParticipantRouteDependencies) {
  const app = new OpenAPIHono();

  const access = async (c: Parameters<typeof researcherFromRequest>[0], draftId: string) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return { failure: [{ error: "Please sign in." }, 401] as const };
    }
    const loaded = await loadDraft(db, draftId);
    const role = loaded ? await roleOnStudy(db, researcher.id, loaded.draft.studyId) : null;
    if (!loaded || !role) {
      return { failure: [{ error: "That isn't available." }, 404] as const };
    }
    return { researcher, loaded, role };
  };
  const latest = async (draftId: string) => {
    const [run] = await db
      .select()
      .from(schema.communityRuns)
      .where(eq(schema.communityRuns.draftId, draftId))
      .orderBy(desc(schema.communityRuns.startedAt))
      .limit(1);
    return run;
  };

  app.openapi(stateRoute, async (c) => {
    const { draftId } = c.req.valid("param");
    const checked = await access(c, draftId);
    if ("failure" in checked) {
      const [body, status] = checked.failure;
      return c.json(body, status);
    }
    const run = await latest(draftId);
    return c.json(
      {
        run: run
          ? {
              id: run.id,
              status: run.status,
              request: run.request,
              progress: {
                days: 0,
                of: 0,
                posts: 0,
                replies: 0,
                dropped: 0,
                ...(run.progress as object),
              },
              costUsd: run.costUsd,
              model: run.model,
              error: run.error,
              startedAt: run.startedAt.toISOString(),
              finishedAt: run.finishedAt?.toISOString() ?? null,
            }
          : null,
      },
      200,
    );
  });

  app.openapi(startRoute, async (c) => {
    const { draftId } = c.req.valid("param");
    const checked = await access(c, draftId);
    if ("failure" in checked) {
      const [body, status] = checked.failure;
      return c.json(body, status);
    }
    if (checked.role === "viewer") {
      return c.json({ error: "You can only view this study." }, 403);
    }
    if (checked.loaded.draft.closedAt !== null) {
      return c.json({ error: "This draft has already been saved as a version." }, 409);
    }
    // Said before starting, not after: no key here, or the lab's budget is used up (ADR 71).
    const noModel = await whyNoModel(writer, { draftId });
    if (!writer || noModel) {
      return c.json({ error: noModel ?? "This server has no Claude key." }, 409);
    }
    const request = c.req.valid("json");
    if (request.daysBefore + request.daysDuring === 0) {
      return c.json({ error: "Choose at least one day." }, 400);
    }
    const running = await latest(draftId);
    if (running?.status === "running" && Date.now() - running.startedAt.getTime() < STALE_MS) {
      return c.json({ error: "A community is already being drafted for this draft." }, 409);
    }
    const script = parseBeats(checked.loaded.pages[BEATS_FILE] ?? "");
    const [run] = await db
      .insert(schema.communityRuns)
      .values({
        draftId,
        request,
        status: "running",
        model: script.live.model,
        startedBy: checked.researcher.id,
      })
      .returning();
    if (!run) {
      return c.json({ error: "That didn't start. Try again." }, 409);
    }
    void draftCommunity({
      db,
      writer,
      runId: run.id,
      draftId,
      researcherId: checked.researcher.id,
      request,
    });
    return c.json({ id: run.id }, 202);
  });

  app.openapi(removeRoute, async (c) => {
    const { draftId, runId } = c.req.valid("param");
    const checked = await access(c, draftId);
    if ("failure" in checked) {
      const [body, status] = checked.failure;
      return c.json(body, status);
    }
    if (checked.role === "viewer") {
      return c.json({ error: "You can only view this study." }, 403);
    }
    const [run] = await db
      .select({ id: schema.communityRuns.id })
      .from(schema.communityRuns)
      .where(and(eq(schema.communityRuns.id, runId), eq(schema.communityRuns.draftId, draftId)));
    if (!run) {
      return c.json({ error: "That isn't available." }, 404);
    }
    // Its posts, which take their replies with them, and any reply left on a post of someone's own.
    const written = checked.loaded.items.filter(
      ({ provenance }) => (provenance as { detail?: { run?: string } }).detail?.run === runId,
    );
    let removed = 0;
    for (const item of [
      ...written.filter(({ kind }) => kind === "post"),
      ...written.filter(({ kind }) => kind === "comment"),
    ]) {
      const result = await deleteItem(db, draftId, item.id, checked.researcher.id);
      if ("deleted" in result) {
        removed += result.deleted;
      }
    }
    return c.json({ removed }, 200);
  });

  return app;
}
