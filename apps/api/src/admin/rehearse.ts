import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { roleOnStudy } from "@truman3/accounts";
import { BEATS_FILE } from "@truman3/core";
import { type ActorData, loadDraft, pageSection, saveSection } from "@truman3/drafts";
import { parseBeats } from "@truman3/study-files";
import { NothingWritten, type Writer } from "@truman3/writer";
import { isMap, isSeq, parseDocument } from "yaml";
import { whyNoModel, writerFor } from "../ai.ts";
import { rehearsalPrompt, saysSomething } from "../director/wording.ts";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import { researcherFromRequest } from "./session.ts";

/** The most lines one beat keeps, the same as `lines` in beats.yaml allows. */
const MAX_LINES = 50;

const errorSchema = z.object({ error: z.string() });
const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: errorSchema } },
});

const listRoute = createRoute({
  method: "get",
  path: "/admin/drafts/{draftId}/beats/rehearse",
  summary: "The saved beats that can be rehearsed, and how many lines each has",
  request: { params: z.object({ draftId: z.uuid() }) },
  responses: {
    200: {
      description: "Improvised posts and comments in the saved beats",
      content: {
        "application/json": {
          schema: z.object({
            hasModel: z.boolean(),
            /** Why this lab can't use a model now, or null if it can (ADR 71). */
            noModel: z.string().nullable(),
            beats: z.array(
              z.object({
                id: z.string(),
                actor: z.string(),
                action: z.enum(["post", "comment", "message"]),
                lines: z.number(),
              }),
            ),
          }),
        },
      },
    },
    401: errorResponse("Not signed in"),
    404: errorResponse("No such draft"),
  },
});

const rehearseRoute = createRoute({
  method: "post",
  path: "/admin/drafts/{draftId}/beats/rehearse",
  summary: "Have the actor's model draft lines for an improvised beat, saved into beats.yaml",
  request: {
    params: z.object({ draftId: z.uuid() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            beat: z.string().min(1),
            count: z.number().int().min(1).max(10).default(5),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "The lines were added to the beat. The page has a new revision",
      content: {
        "application/json": {
          schema: z.object({
            lines: z.array(z.string()),
            model: z.string(),
            costUsd: z.number(),
            revision: z.number(),
          }),
        },
      },
    },
    400: errorResponse("That beat can't be rehearsed"),
    401: errorResponse("Not signed in"),
    403: errorResponse("This researcher can only view"),
    404: errorResponse("No such draft or beat"),
    409: errorResponse("No model, the draft is closed, or someone saved the beats meanwhile"),
    502: errorResponse("The model didn't write anything"),
  },
});

/**
 * Rehearsing: before launch, the actor's model drafts lines for an improvised beat, and they go
 * into the beat's `lines` in beats.yaml, keeping the file's comments. Researchers read and edit
 * them there like anything else, and they're frozen with the version. See ADR 54.
 */
export function createRehearseRoutes({ db, writer }: ParticipantRouteDependencies) {
  const app = new OpenAPIHono();

  app.openapi(listRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json({ error: "Please sign in." }, 401);
    }
    const loaded = await loadDraft(db, c.req.valid("param").draftId);
    const role = loaded ? await roleOnStudy(db, researcher.id, loaded.draft.studyId) : null;
    if (!loaded || !role) {
      return c.json({ error: "That isn't available." }, 404);
    }
    const { beats } = parseBeats(loaded.pages[BEATS_FILE] ?? "");
    const noModel = await whyNoModel(writer, { draftId: c.req.valid("param").draftId });
    return c.json(
      {
        hasModel: noModel === null,
        noModel,
        beats: beats.flatMap(({ id, do: action }) =>
          saysSomething(action) && action.improvise
            ? [{ id, actor: action.actor, action: action.action, lines: action.lines?.length ?? 0 }]
            : [],
        ),
      },
      200,
    );
  });

  app.openapi(rehearseRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json({ error: "Please sign in." }, 401);
    }
    const { draftId } = c.req.valid("param");
    const loaded = await loadDraft(db, draftId);
    const role = loaded ? await roleOnStudy(db, researcher.id, loaded.draft.studyId) : null;
    if (!loaded || !role) {
      return c.json({ error: "That isn't available." }, 404);
    }
    if (role === "viewer") {
      return c.json({ error: "You can only view this study." }, 403);
    }
    if (loaded.draft.closedAt !== null) {
      return c.json({ error: "This draft has already been saved as a version." }, 409);
    }
    if (!writer) {
      return c.json({ error: "This server has no model key, so it can't rehearse." }, 409);
    }

    const { beat: beatId, count } = c.req.valid("json");
    const text = loaded.pages[BEATS_FILE] ?? "";
    const revision = loaded.sections.get(pageSection(BEATS_FILE))?.revision ?? 0;
    const script = parseBeats(text);
    if (script.issues.some(({ severity }) => severity === "error")) {
      return c.json({ error: "Fix the problems in the saved beats first." }, 400);
    }
    const beat = script.beats.find(({ id }) => id === beatId);
    if (!beat) {
      return c.json({ error: `There's no saved beat called ${beatId}.` }, 404);
    }
    const action = beat.do;
    if ((action.action !== "post" && action.action !== "comment") || !action.improvise) {
      return c.json({ error: "Only a post or comment that improvises can be rehearsed." }, 400);
    }
    const existing = action.lines ?? [];
    if (existing.length >= MAX_LINES) {
      return c.json({ error: `This beat already has ${MAX_LINES} lines.` }, 400);
    }

    const actor = loaded.items.find(
      ({ kind, data }) => kind === "actor" && (data as ActorData).username === action.actor,
    );
    const name = actor ? (actor.data as ActorData).name : action.actor;
    const { system, user } = rehearsalPrompt(script, action, name);
    let rehearsed: Awaited<ReturnType<Writer["rehearse"]>>;
    try {
      // The study's lab's key, or the host's within its starter budget (ADR 71).
      const model = (await writerFor(writer, { draftId })) as Writer;
      rehearsed = await model.rehearse({
        model: script.live.model,
        system,
        prompt: user,
        maxLength: script.live.maxLength,
        count: Math.min(count, MAX_LINES - existing.length),
      });
    } catch (cause) {
      const message =
        cause instanceof NothingWritten ? cause.message : "The model couldn't be reached.";
      return c.json({ error: message }, 502);
    }
    const added = rehearsed.lines
      .map((line) => line.trim().slice(0, script.live.maxLength))
      .filter((line) => line.length > 0 && !existing.includes(line));

    const saved = await saveSection(db, draftId, researcher.id, {
      section: pageSection(BEATS_FILE),
      value: withLines(text, beatId, [...existing, ...added]),
      baseRevision: revision,
    });
    if ("problem" in saved) {
      return c.json({ error: saved.message }, saved.problem === "not-found" ? 404 : 409);
    }
    return c.json(
      {
        lines: added,
        model: rehearsed.model,
        costUsd: rehearsed.costUsd,
        revision: saved.revision,
      },
      200,
    );
  });

  return app;
}

/** beats.yaml with one beat's `lines` set, and everything else, comments included, as it was. */
export function withLines(text: string, beatId: string, lines: string[]): string {
  const document = parseDocument(text);
  const beats = document.get("beats");
  const beat = isSeq(beats)
    ? beats.items.find((item) => isMap(item) && item.get("id") === beatId)
    : undefined;
  const action = isMap(beat) ? beat.get("do") : undefined;
  if (!isMap(action)) {
    throw new Error(`There's no beat called ${beatId} to add lines to.`);
  }
  const node = document.createNode(lines);
  node.flow = false;
  action.set("lines", node);
  return document.toString({ lineWidth: 0 });
}
