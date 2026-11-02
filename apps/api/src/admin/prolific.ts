import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { roleOnStudy } from "@truman3/accounts";
import type { StudySettings } from "@truman3/core";
import { type Database, schema } from "@truman3/db";
import {
  type ApprovalRules,
  BONUSES_PER_REQUEST,
  type CompletionCodes,
  completionUrl,
  createProlificClient,
  decryptSecret,
  encryptSecret,
  entryUrl,
  newCompletionCodes,
  type ParticipantActivity,
  ProlificError,
  type ProlificSubmission,
  parseSecretKey,
  unmetRules,
} from "@truman3/recruit";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import { researcherFromRequest } from "./session.ts";

/** How this server reaches Prolific. Leave out the secret key and connecting is turned off. */
export interface ProlificConfig {
  secretKey?: string | undefined;
  apiUrl?: string | undefined;
  /** The participant app's address, which goes in the link Prolific sends people to. */
  participantAppUrl: string;
  /** Tests use this to stand in for Prolific. */
  fetch?: typeof fetch;
}

const errorSchema = z.object({ error: z.string() });
const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: errorSchema } },
});
const json = <T extends z.ZodType>(description: string, responseSchema: T) => ({
  description,
  content: { "application/json": { schema: responseSchema } },
});
const body = <T extends z.ZodType>(requestSchema: T) => ({
  body: { required: true, content: { "application/json": { schema: requestSchema } } },
});
const studyParams = z.object({ studyId: z.uuid() });
const commonErrors = {
  400: errorResponse("Prolific refused, or something's missing"),
  401: errorResponse("Not signed in"),
  403: errorResponse("This researcher can't do this"),
  404: errorResponse("Not available"),
  409: errorResponse("This doesn't fit the study's current state"),
  502: errorResponse("Prolific couldn't be reached"),
  503: errorResponse("This server isn't set up to connect to Prolific"),
};

const rulesSchema = z.strictObject({
  minViewMinutes: z.number().positive().optional(),
  minPostsSeen: z.number().int().positive().optional(),
  minActions: z.number().int().positive().optional(),
});

const connectionSchema = z.object({
  available: z.boolean(),
  connected: z.boolean(),
  name: z.string().nullable(),
});

const connectionRoute = createRoute({
  method: "get",
  path: "/admin/prolific",
  summary: "Whether this researcher has connected their Prolific account",
  responses: { 200: json("Their connection", connectionSchema), ...commonErrors },
});

const connectRoute = createRoute({
  method: "put",
  path: "/admin/prolific",
  summary: "Connect this researcher's own Prolific account. The token can't be read back",
  request: body(z.object({ token: z.string().trim().min(1) })),
  responses: { 200: json("Connected", connectionSchema), ...commonErrors },
});

const disconnectRoute = createRoute({
  method: "delete",
  path: "/admin/prolific",
  summary: "Forget this researcher's Prolific token",
  responses: { 200: json("Forgotten", connectionSchema), ...commonErrors },
});

const projectsRoute = createRoute({
  method: "get",
  path: "/admin/prolific/projects",
  summary: "The Prolific projects this researcher can reach",
  responses: {
    200: json(
      "Their projects",
      z.object({
        projects: z.array(z.object({ id: z.string(), title: z.string(), workspace: z.string() })),
      }),
    ),
    ...commonErrors,
  },
});

const submissionSchema = z.object({
  id: z.string(),
  prolificId: z.string(),
  status: z.string(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  /** Which of this study's codes they used. */
  code: z.enum(["finished", "needs review", "declined", "other", "none"]),
  /** Where they are in this study, or null if nobody here has this ID. */
  inStudy: z.enum(["finished", "in progress"]).nullable(),
  viewedMinutes: z.number().nullable(),
  postsSeen: z.number().nullable(),
  actions: z.number().nullable(),
  /** What's stopping this person passing. Empty means they pass. */
  problems: z.array(z.string()),
});

const studyStateSchema = z.object({
  role: z.string(),
  slug: z.string(),
  title: z.string(),
  hasVersion: z.boolean(),
  launched: z.boolean(),
  /** The exit step sends people to a survey, which then has to send them to Prolific. */
  surveyAfter: z.boolean(),
  link: z
    .object({
      prolificStudyId: z.string(),
      prolificStatus: z.string().nullable(),
      reviewMode: z.enum(["manual", "automatic"]),
      rules: rulesSchema,
      finishedUrl: z.string(),
      createdBy: z.string(),
    })
    .nullable(),
  submissions: z.array(submissionSchema).nullable(),
  /** Why the submissions couldn't be fetched. */
  submissionsProblem: z.string().nullable(),
  actions: z.array(
    z.object({
      by: z.string(),
      action: z.string(),
      people: z.number().nullable(),
      amount: z.number().nullable(),
      at: z.string(),
    }),
  ),
});

const studyStateRoute = createRoute({
  method: "get",
  path: "/admin/studies/{studyId}/prolific",
  summary: "A study's link to Prolific, and its submissions as this researcher's account sees them",
  request: { params: studyParams },
  responses: { 200: json("The study's state", studyStateSchema), ...commonErrors },
});

const createDraftRoute = createRoute({
  method: "post",
  path: "/admin/studies/{studyId}/prolific",
  summary: "Create an unpublished draft on Prolific. Publishing it happens on Prolific",
  request: {
    params: studyParams,
    ...body(
      z.object({
        project: z.string().min(1),
        name: z.string().trim().min(1),
        description: z.string().trim().min(1),
        minutes: z.number().int().positive(),
        /** In the smallest unit of the currency, such as cents. */
        reward: z.number().int().positive(),
        places: z.number().int().positive(),
        reviewMode: z.enum(["manual", "automatic"]),
        rules: rulesSchema,
      }),
    ),
  },
  responses: { 200: json("Created", z.object({ prolificStudyId: z.string() })), ...commonErrors },
});

const updateRulesRoute = createRoute({
  method: "put",
  path: "/admin/studies/{studyId}/prolific/rules",
  summary: "Change what's expected of someone before they're approved",
  request: { params: studyParams, ...body(z.object({ rules: rulesSchema })) },
  responses: { 200: json("Saved", z.object({ rules: rulesSchema })), ...commonErrors },
});

const unlinkRoute = createRoute({
  method: "delete",
  path: "/admin/studies/{studyId}/prolific",
  summary: "Stop linking this study to Prolific. Nothing on Prolific changes",
  request: { params: studyParams },
  responses: { 200: json("Unlinked", z.object({ unlinked: z.boolean() })), ...commonErrors },
});

const submissionIds = z.array(z.string().min(1)).min(1);

const approveRoute = createRoute({
  method: "post",
  path: "/admin/studies/{studyId}/prolific/approve",
  summary: "Approve submissions, which pays people",
  request: { params: studyParams, ...body(z.object({ submissionIds })) },
  responses: { 200: json("Accepted", z.object({ people: z.number() })), ...commonErrors },
});

const setUpBonusRoute = createRoute({
  method: "post",
  path: "/admin/studies/{studyId}/prolific/bonuses",
  summary: "Set up a bonus and see what it costs. This doesn't pay anyone",
  request: {
    params: studyParams,
    ...body(
      z.object({
        submissionIds,
        /** Each, in the study's currency: 1.50 means one dollar fifty, not cents. */
        amount: z.number().positive().multipleOf(0.01),
      }),
    ),
  },
  responses: {
    200: json(
      "Ready to pay",
      z.object({
        id: z.string(),
        people: z.number(),
        amount: z.number(),
        fees: z.number(),
        vat: z.number(),
        totalAmount: z.number(),
      }),
    ),
    ...commonErrors,
  },
});

const payBonusRoute = createRoute({
  method: "post",
  path: "/admin/studies/{studyId}/prolific/bonuses/{bonusId}/pay",
  summary: "Pay a bonus that's been set up. This spends money, and can only be done once",
  request: { params: z.object({ studyId: z.uuid(), bonusId: z.string().min(1) }) },
  responses: { 200: json("Accepted", z.object({ paid: z.boolean() })), ...commonErrors },
});

/** What each person did, from the events, so nothing depends on a table that could drift. */
export async function activityOf(
  db: Pick<Database, "select">,
  participantIds: readonly string[],
): Promise<Map<string, ParticipantActivity>> {
  if (participantIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      participantId: schema.events.participantId,
      viewedMs: sql<string>`coalesce(sum((${schema.events.payload}->>'dwellMs')::numeric) filter (where ${schema.events.type} = 'content.viewed'), 0)`,
      postsSeen: sql<string>`count(distinct ${schema.events.targetContentId}) filter (where ${schema.events.type} = 'content.viewed')`,
      actions: sql<string>`count(*) filter (where ${schema.events.type} in ('content.created', 'content.liked', 'content.flagged', 'actor.followed'))`,
    })
    .from(schema.events)
    .where(
      and(
        inArray(schema.events.participantId, [...participantIds]),
        eq(schema.events.source, "participant"),
      ),
    )
    .groupBy(schema.events.participantId);
  return new Map(
    rows.flatMap(({ participantId, viewedMs, postsSeen, actions }) =>
      participantId
        ? [
            [
              participantId,
              {
                viewedMs: Number(viewedMs),
                postsSeen: Number(postsSeen),
                actions: Number(actions),
              },
            ] as const,
          ]
        : [],
    ),
  );
}

const codeLabel = (used: string | null | undefined, codes: CompletionCodes) => {
  if (!used) {
    return "none" as const;
  }
  if (used === codes.finished) {
    return "finished" as const;
  }
  if (used === codes.needsReview) {
    return "needs review" as const;
  }
  return used === codes.declined ? ("declined" as const) : ("other" as const);
};

export function createProlificRoutes({ db, prolific: config }: ParticipantRouteDependencies) {
  const app = new OpenAPIHono();
  const secretKey = parseSecretKey(config?.secretKey);
  const pleaseSignIn = { error: "Please sign in." };
  const notAvailable = { error: "This isn't available." };
  const notSetUp = {
    error: "This server isn't set up to connect to Prolific. It needs TRUMAN_SECRET_KEY.",
  };
  const notConnected = { error: "Connect your Prolific account first." };

  const clientFor = async (researcherId: string) => {
    if (!secretKey || !config) {
      return null;
    }
    const [row] = await db
      .select()
      .from(schema.prolificConnections)
      .where(eq(schema.prolificConnections.researcherId, researcherId));
    if (!row) {
      return null;
    }
    try {
      return newClient(decryptSecret(row.tokenEncrypted, secretKey));
    } catch {
      // The server's key changed, so this person has to connect again.
      return null;
    }
  };

  const newClient = (token: string) =>
    createProlificClient({
      token,
      ...(config?.apiUrl ? { apiUrl: config.apiUrl } : {}),
      ...(config?.fetch ? { fetch: config.fetch } : {}),
    });

  /** Says what went wrong, without passing along anything that could include a token. */
  const prolificProblem = (error: unknown) => {
    if (error instanceof ProlificError) {
      if (error.status === 401) {
        return {
          status: 400 as const,
          message: "Prolific didn't accept your token. Connect your account again.",
        };
      }
      if (error.status === 403 || error.status === 404) {
        return {
          status: 403 as const,
          message:
            "Your Prolific account can't do this. Ask whoever runs this study on Prolific to add you.",
        };
      }
      if (error.status < 500) {
        return { status: 400 as const, message: `Prolific said: ${error.message}` };
      }
    }
    console.error("Prolific request failed:", error instanceof Error ? error.message : "unknown");
    return { status: 502 as const, message: "Prolific couldn't be reached. Try again." };
  };

  const currentSettings = async (studyId: string, liveVersionId: string | null) => {
    const versions = await db
      .select({ id: schema.studyVersions.id, settings: schema.studyVersions.settings })
      .from(schema.studyVersions)
      .where(eq(schema.studyVersions.studyId, studyId))
      .orderBy(desc(schema.studyVersions.version));
    const version = versions.find(({ id }) => id === liveVersionId) ?? versions[0];
    return version?.settings as StudySettings | undefined;
  };

  const linkOf = async (studyId: string) => {
    const [link] = await db
      .select()
      .from(schema.prolificLinks)
      .where(eq(schema.prolificLinks.studyId, studyId));
    return link;
  };

  /** Viewers can't reach any of this, since submissions show people's Prolific IDs. */
  const studyAccess = async (researcherId: string, studyId: string) => {
    const role = await roleOnStudy(db, researcherId, studyId);
    const [study] = await db.select().from(schema.studies).where(eq(schema.studies.id, studyId));
    return role && study ? { role, study } : null;
  };

  const viewersCant = { error: "Viewers can't see a study's Prolific details." };

  app.openapi(connectionRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    if (!secretKey) {
      return c.json({ available: false, connected: false, name: null }, 200);
    }
    const client = await clientFor(researcher.id);
    if (!client) {
      return c.json({ available: true, connected: false, name: null }, 200);
    }
    const me = await client.me().catch(() => null);
    return c.json(
      { available: true, connected: true, name: me?.display_name ?? me?.first_name ?? null },
      200,
    );
  });

  app.openapi(connectRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    if (!secretKey) {
      return c.json(notSetUp, 503);
    }
    const { token } = c.req.valid("json");
    try {
      const me = await newClient(token).me();
      const tokenEncrypted = encryptSecret(token, secretKey);
      await db
        .insert(schema.prolificConnections)
        .values({ researcherId: researcher.id, tokenEncrypted })
        .onConflictDoUpdate({
          target: schema.prolificConnections.researcherId,
          set: { tokenEncrypted, connectedAt: new Date() },
        });
      return c.json(
        { available: true, connected: true, name: me.display_name ?? me.first_name ?? null },
        200,
      );
    } catch (error) {
      const { status, message } = prolificProblem(error);
      return c.json({ error: message }, status);
    }
  });

  app.openapi(disconnectRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    await db
      .delete(schema.prolificConnections)
      .where(eq(schema.prolificConnections.researcherId, researcher.id));
    return c.json({ available: secretKey !== null, connected: false, name: null }, 200);
  });

  app.openapi(projectsRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const client = await clientFor(researcher.id);
    if (!client) {
      return c.json(notConnected, 409);
    }
    try {
      return c.json({ projects: await client.projects() }, 200);
    } catch (error) {
      const { status, message } = prolificProblem(error);
      return c.json({ error: message }, status);
    }
  });

  app.openapi(studyStateRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const { studyId } = c.req.valid("param");
    const access = await studyAccess(researcher.id, studyId);
    if (!access) {
      return c.json(notAvailable, 404);
    }
    if (access.role === "viewer") {
      return c.json(viewersCant, 403);
    }
    const { study, role } = access;
    const settings = await currentSettings(studyId, study.liveVersionId);
    const link = await linkOf(studyId);
    const codes = link?.codes as CompletionCodes | undefined;
    const rules = (link?.rules ?? {}) as ApprovalRules;

    let submissions: z.infer<typeof submissionSchema>[] | null = null;
    let submissionsProblem: string | null = null;
    let prolificStatus: string | null = null;

    if (link && codes) {
      const client = await clientFor(researcher.id);
      if (!client) {
        submissionsProblem = "Connect your Prolific account to see submissions.";
      } else {
        try {
          const [found, prolificStudy] = await Promise.all([
            client.submissions(link.prolificStudyId),
            client.study(link.prolificStudyId),
          ]);
          prolificStatus = prolificStudy.status ?? null;
          submissions = await matchSubmissions(studyId, found, codes, rules);
        } catch (error) {
          submissionsProblem = prolificProblem(error).message;
        }
      }
    }

    const actions = await db
      .select()
      .from(schema.prolificActions)
      .where(eq(schema.prolificActions.studyId, studyId))
      .orderBy(desc(schema.prolificActions.id))
      .limit(20);

    return c.json(
      {
        role,
        slug: study.slug,
        title: settings?.title ?? study.slug,
        hasVersion: settings !== undefined,
        launched: study.liveVersionId !== null,
        surveyAfter: settings?.flow.some((step) => step.step === "exit" && step.redirect) ?? false,
        link:
          link && codes
            ? {
                prolificStudyId: link.prolificStudyId,
                prolificStatus,
                reviewMode: link.reviewMode as "manual" | "automatic",
                rules: rules as z.infer<typeof rulesSchema>,
                finishedUrl: completionUrl(codes.finished),
                createdBy: link.createdBy,
              }
            : null,
        submissions,
        submissionsProblem,
        actions: actions.map(({ by, action, people, amount, at }) => ({
          by,
          action,
          people,
          amount,
          at: at.toISOString(),
        })),
      },
      200,
    );
  });

  /** Puts Prolific's list beside what happened here. Nothing about it gets stored (ADR 17). */
  const matchSubmissions = async (
    studyId: string,
    found: ProlificSubmission[],
    codes: CompletionCodes,
    rules: ApprovalRules,
  ) => {
    const ids = [...new Set(found.map((item) => item.participant_id))];
    const people =
      ids.length === 0
        ? []
        : await db
            .select({
              id: schema.participants.id,
              externalId: schema.participants.externalId,
              status: schema.participants.status,
            })
            .from(schema.participants)
            .where(
              and(
                eq(schema.participants.studyId, studyId),
                inArray(schema.participants.externalId, ids),
              ),
            );
    const activity = await activityOf(
      db,
      people.map(({ id }) => id),
    );

    return found.map((item) => {
      const person = people.find(({ externalId }) => externalId === item.participant_id);
      const did = person
        ? (activity.get(person.id) ?? { viewedMs: 0, postsSeen: 0, actions: 0 })
        : null;
      const problems = !person
        ? ["Nobody here has this ID. They may have withdrawn, declined, or never arrived"]
        : [
            ...(person.status === "completed" ? [] : ["Hasn't finished the study here"]),
            ...(did ? unmetRules(rules, did) : []),
          ];
      return {
        id: item.id,
        prolificId: item.participant_id,
        status: item.status,
        startedAt: item.started_at,
        completedAt: item.completed_at ?? null,
        code: codeLabel(item.study_code, codes),
        inStudy: person
          ? person.status === "completed"
            ? ("finished" as const)
            : ("in progress" as const)
          : null,
        viewedMinutes: did ? Math.round((did.viewedMs / 60_000) * 10) / 10 : null,
        postsSeen: did?.postsSeen ?? null,
        actions: did?.actions ?? null,
        problems,
      };
    });
  };

  app.openapi(createDraftRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const { studyId } = c.req.valid("param");
    const access = await studyAccess(researcher.id, studyId);
    if (!access) {
      return c.json(notAvailable, 404);
    }
    if (access.role === "viewer") {
      return c.json(viewersCant, 403);
    }
    const client = await clientFor(researcher.id);
    if (!client || !config) {
      return c.json(notConnected, 409);
    }
    if (await linkOf(studyId)) {
      return c.json({ error: "This study is already linked to a Prolific study." }, 409);
    }
    const settings = await currentSettings(studyId, access.study.liveVersionId);
    if (!settings) {
      return c.json({ error: "Save a version of this study first." }, 409);
    }
    const input = c.req.valid("json");
    const surveyAfter = settings.flow.some((step) => step.step === "exit" && step.redirect);
    if (input.reviewMode === "automatic" && surveyAfter) {
      return c.json(
        {
          error:
            "Automatic approval needs Truman to send people to Prolific, but this study sends them to a survey first.",
        },
        400,
      );
    }

    const codes = newCompletionCodes(input.reviewMode);
    try {
      const created = await client.createDraft({
        name: input.name,
        description: input.description,
        externalStudyUrl: entryUrl(
          config.participantAppUrl,
          access.study.slug,
          settings.entry.idParam,
        ),
        project: input.project,
        places: input.places,
        minutes: input.minutes,
        reward: input.reward,
        reviewMode: input.reviewMode,
        codes,
      });
      await db.transaction(async (tx) => {
        await tx.insert(schema.prolificLinks).values({
          studyId,
          prolificStudyId: created.id,
          reviewMode: input.reviewMode,
          codes,
          rules: input.rules,
          createdBy: researcher.email,
        });
        await tx
          .insert(schema.prolificActions)
          .values({ studyId, by: researcher.email, action: "created draft" });
      });
      return c.json({ prolificStudyId: created.id }, 200);
    } catch (error) {
      const { status, message } = prolificProblem(error);
      return c.json({ error: message }, status);
    }
  });

  app.openapi(updateRulesRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const { studyId } = c.req.valid("param");
    const access = await studyAccess(researcher.id, studyId);
    if (!access) {
      return c.json(notAvailable, 404);
    }
    if (access.role === "viewer") {
      return c.json(viewersCant, 403);
    }
    const { rules } = c.req.valid("json");
    const updated = await db
      .update(schema.prolificLinks)
      .set({ rules })
      .where(eq(schema.prolificLinks.studyId, studyId))
      .returning({ studyId: schema.prolificLinks.studyId });
    if (updated.length === 0) {
      return c.json({ error: "This study isn't linked to Prolific." }, 409);
    }
    return c.json({ rules }, 200);
  });

  app.openapi(unlinkRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const { studyId } = c.req.valid("param");
    const access = await studyAccess(researcher.id, studyId);
    if (!access) {
      return c.json(notAvailable, 404);
    }
    if (access.role === "viewer") {
      return c.json(viewersCant, 403);
    }
    const removed = await db
      .delete(schema.prolificLinks)
      .where(eq(schema.prolificLinks.studyId, studyId))
      .returning({ studyId: schema.prolificLinks.studyId });
    if (removed.length > 0) {
      await db
        .insert(schema.prolificActions)
        .values({ studyId, by: researcher.email, action: "unlinked" });
    }
    return c.json({ unlinked: removed.length > 0 }, 200);
  });

  /** Checks the IDs against Prolific, using this person's access, before anything touches money. */
  const moneyContext = async (researcherId: string, studyId: string) => {
    const access = await studyAccess(researcherId, studyId);
    if (!access) {
      return { problem: { status: 404 as const, body: notAvailable } } as const;
    }
    if (access.role === "viewer") {
      return { problem: { status: 403 as const, body: viewersCant } } as const;
    }
    const link = await linkOf(studyId);
    if (!link) {
      return {
        problem: { status: 409 as const, body: { error: "This study isn't linked to Prolific." } },
      } as const;
    }
    const client = await clientFor(researcherId);
    if (!client) {
      return { problem: { status: 409 as const, body: notConnected } } as const;
    }
    return { problem: null, link, client } as const;
  };

  app.openapi(approveRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const { studyId } = c.req.valid("param");
    const context = await moneyContext(researcher.id, studyId);
    if (context.problem) {
      return c.json(context.problem.body, context.problem.status);
    }
    const { link, client } = context;
    const ids = [...new Set(c.req.valid("json").submissionIds)];
    try {
      const found = await client.submissions(link.prolificStudyId);
      const waiting = new Set(
        found.filter(({ status }) => status === "AWAITING REVIEW").map(({ id }) => id),
      );
      const notWaiting = ids.filter((id) => !waiting.has(id));
      if (notWaiting.length > 0) {
        return c.json(
          {
            error: `${notWaiting.length} of these aren't waiting for review in this study, so nothing was approved. Refresh and try again.`,
          },
          409,
        );
      }
      await client.approve(ids);
      await db.insert(schema.prolificActions).values({
        studyId,
        by: researcher.email,
        action: "approved",
        people: ids.length,
      });
      return c.json({ people: ids.length }, 200);
    } catch (error) {
      const { status, message } = prolificProblem(error);
      return c.json({ error: message }, status);
    }
  });

  app.openapi(setUpBonusRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const { studyId } = c.req.valid("param");
    const context = await moneyContext(researcher.id, studyId);
    if (context.problem) {
      return c.json(context.problem.body, context.problem.status);
    }
    const { link, client } = context;
    const { submissionIds: requested, amount } = c.req.valid("json");
    const ids = [...new Set(requested)];
    if (ids.length > BONUSES_PER_REQUEST) {
      return c.json(
        { error: `Pay up to ${BONUSES_PER_REQUEST} people at a time, as Prolific recommends.` },
        400,
      );
    }
    try {
      const found = new Set((await client.submissions(link.prolificStudyId)).map(({ id }) => id));
      if (ids.some((id) => !found.has(id))) {
        return c.json({ error: "Some of these aren't submissions in this study." }, 409);
      }
      const setup = await client.setUpBonus(
        link.prolificStudyId,
        ids.map((submissionId) => ({ submissionId, amount })),
      );
      await db.insert(schema.prolificBonuses).values({
        id: setup.id,
        studyId,
        people: ids.length,
        totalAmount: Math.round(setup.totalAmount),
        createdBy: researcher.email,
      });
      return c.json({ ...setup, people: ids.length }, 200);
    } catch (error) {
      const { status, message } = prolificProblem(error);
      return c.json({ error: message }, status);
    }
  });

  app.openapi(payBonusRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const { studyId, bonusId } = c.req.valid("param");
    const context = await moneyContext(researcher.id, studyId);
    if (context.problem) {
      return c.json(context.problem.body, context.problem.status);
    }
    const { client } = context;

    // Claimed first. Paying twice pays people twice, so two clicks can't both get through.
    const [claimed] = await db
      .update(schema.prolificBonuses)
      .set({ payingAt: new Date(), paidBy: researcher.email })
      .where(
        and(
          eq(schema.prolificBonuses.id, bonusId),
          eq(schema.prolificBonuses.studyId, studyId),
          isNull(schema.prolificBonuses.payingAt),
        ),
      )
      .returning();
    if (!claimed) {
      return c.json(
        { error: "This bonus has already been paid, or isn't one of this study's." },
        409,
      );
    }

    try {
      await client.payBonus(bonusId);
    } catch (error) {
      // Prolific said no, so nothing was paid and it can be tried again. Any other failure might
      // have reached them, so it stays claimed, and someone has to check on Prolific.
      if (error instanceof ProlificError && error.status < 500) {
        await db
          .update(schema.prolificBonuses)
          .set({ payingAt: null, paidBy: null })
          .where(eq(schema.prolificBonuses.id, bonusId));
        const { status, message } = prolificProblem(error);
        return c.json({ error: message }, status);
      }
      return c.json(
        {
          error:
            "Prolific didn't confirm this payment, and it may have gone through. Check your Prolific account before setting up another.",
        },
        502,
      );
    }
    await db.insert(schema.prolificActions).values({
      studyId,
      by: researcher.email,
      action: "paid bonus",
      people: claimed.people,
      amount: claimed.totalAmount,
    });
    return c.json({ paid: true }, 200);
  });

  return app;
}
