import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { roleOnStudy } from "@truman3/accounts";
import { BEATS_FILE, type Persona, personaSchema } from "@truman3/core";
import { type ActorData, loadDraft, pageSection, saveSection } from "@truman3/drafts";
import { parseBeats } from "@truman3/study-files";
import { isMap, parseDocument } from "yaml";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import { researcherFromRequest } from "./session.ts";

// Persona cards, edited as a form on the Cast page. They're kept in beats.yaml, under `cast`, where
// live writing, rehearsing, and the community read them (ADR 52).

const errorBody = { "application/json": { schema: z.object({ error: z.string() }) } };
const params = z.object({ draftId: z.uuid() });

const listRoute = createRoute({
  method: "get",
  path: "/admin/drafts/{draftId}/persona-cards",
  summary: "Everyone's persona card, by username",
  request: { params },
  responses: {
    200: {
      description: "The cards. Someone without one isn't listed",
      content: {
        "application/json": {
          schema: z.object({
            cards: z.record(z.string(), personaSchema),
            /** Why they can't be edited as a form, if beats.yaml can't be read. */
            problem: z.string().nullable(),
          }),
        },
      },
    },
    401: { description: "Not signed in", content: errorBody },
    404: { description: "No such draft", content: errorBody },
  },
});

const saveRoute = createRoute({
  method: "put",
  path: "/admin/drafts/{draftId}/persona-cards/{username}",
  summary: "Set one person's persona card. An empty card takes it away",
  request: {
    params: params.extend({ username: z.string().min(1).max(100) }),
    body: { required: true, content: { "application/json": { schema: personaSchema } } },
  },
  responses: {
    200: {
      description: "Saved into beats.yaml",
      content: { "application/json": { schema: z.object({ revision: z.number() }) } },
    },
    400: { description: "Something about the card", content: errorBody },
    401: { description: "Not signed in", content: errorBody },
    403: { description: "Viewers can't", content: errorBody },
    404: { description: "No such draft, or nobody by that username", content: errorBody },
    409: { description: "The draft is saved, or beats.yaml can't be read", content: errorBody },
  },
});

/** A card with nothing in it left out, so an emptied field doesn't leave an empty line behind. */
function tidy(card: Persona): Partial<Persona> {
  const relationships = Object.fromEntries(
    Object.entries(card.relationships ?? {}).filter(([, feeling]) => feeling.trim()),
  );
  return {
    ...(card.about?.trim() ? { about: card.about.trim() } : {}),
    ...(card.voice?.trim() ? { voice: card.voice.trim() } : {}),
    ...(card.values?.trim() ? { values: card.values.trim() } : {}),
    ...(card.goals?.trim() ? { goals: card.goals.trim() } : {}),
    ...(Object.keys(relationships).length > 0 ? { relationships } : {}),
    ...(card.redLines.length > 0 ? { redLines: card.redLines } : {}),
  };
}

/** beats.yaml with one person's card set or taken away, and everything else as it was. */
export function withPersonaCard(text: string, username: string, card: Persona): string {
  const document = parseDocument(text.trim() ? text : "beats: []\n");
  const kept = tidy(card);
  const cast = document.get("cast");
  if (Object.keys(kept).length === 0) {
    if (isMap(cast)) {
      cast.delete(username);
      if (cast.items.length === 0) {
        document.delete("cast");
      }
    }
  } else {
    document.setIn(["cast", username], document.createNode(kept));
  }
  return document.toString({ lineWidth: 0 });
}

export function createPersonaCardRoutes({ db }: ParticipantRouteDependencies) {
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

  app.openapi(listRoute, async (c) => {
    const { draftId } = c.req.valid("param");
    const checked = await access(c, draftId);
    if ("failure" in checked) {
      const [body, status] = checked.failure;
      return c.json(body, status);
    }
    const read = parseBeats(checked.loaded.pages[BEATS_FILE] ?? "");
    return c.json(
      {
        cards: read.cast,
        problem:
          read.issues.length > 0 ? "beats.yaml has problems. Fix those on the Beats page." : null,
      },
      200,
    );
  });

  app.openapi(saveRoute, async (c) => {
    const { draftId, username } = c.req.valid("param");
    const checked = await access(c, draftId);
    if ("failure" in checked) {
      const [body, status] = checked.failure;
      return c.json(body, status);
    }
    if (checked.role === "viewer") {
      return c.json({ error: "You can only view this study." }, 403);
    }
    const usernames = new Set(
      checked.loaded.items
        .filter(({ kind }) => kind === "actor")
        .map(({ data }) => (data as ActorData).username),
    );
    if (!usernames.has(username)) {
      return c.json({ error: "There's nobody in the cast by that username." }, 404);
    }
    const card = c.req.valid("json");
    const stranger = Object.keys(card.relationships ?? {}).find(
      (other) => other !== "participant" && !usernames.has(other),
    );
    if (stranger) {
      return c.json({ error: `"${stranger}" isn't in the cast.` }, 400);
    }
    const text = checked.loaded.pages[BEATS_FILE] ?? "";
    if (parseBeats(text).issues.length > 0) {
      return c.json({ error: "beats.yaml has problems. Fix those on the Beats page first." }, 409);
    }
    const saved = await saveSection(db, draftId, checked.researcher.id, {
      section: pageSection(BEATS_FILE),
      value: withPersonaCard(text, username, card),
      baseRevision: checked.loaded.sections.get(pageSection(BEATS_FILE))?.revision ?? 0,
    });
    if ("problem" in saved) {
      return c.json({ error: saved.message }, saved.problem === "not-found" ? 404 : 409);
    }
    return c.json({ revision: saved.revision }, 200);
  });

  return app;
}
