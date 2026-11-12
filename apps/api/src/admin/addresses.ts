import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { roleOnStudy } from "@truman3/accounts";
import { schema } from "@truman3/db";
import { eq } from "drizzle-orm";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import { researcherFromRequest } from "./session.ts";

/**
 * Where a study's participants go (ADR 74): the participant app's own address, or one of the
 * server's participant domains, so the address bar doesn't say "research".
 */

/**
 * A study's address. A domain that's no longer offered falls back to the participant app's own,
 * so a link never points somewhere this server doesn't answer.
 */
export function studyAddress(
  domain: string | null,
  participantAppUrl: string,
  participantDomains: readonly string[] = [],
) {
  return domain && participantDomains.includes(domain) ? `https://${domain}` : participantAppUrl;
}

const errorSchema = z.object({ error: z.string() });
const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: errorSchema } },
});

const addressesRoute = createRoute({
  method: "get",
  path: "/admin/addresses",
  summary: "The addresses a study can use",
  responses: {
    200: {
      description: "The participant app's own address, and the domains a study can run at",
      content: {
        "application/json": {
          schema: z.object({ default: z.string(), domains: z.array(z.string()) }),
        },
      },
    },
    401: errorResponse("Not signed in"),
  },
});

const setAddressRoute = createRoute({
  method: "put",
  path: "/admin/studies/{studyId}/address",
  summary: "Choose the domain a study's participants use, or none for the usual address",
  request: {
    params: z.object({ studyId: z.uuid() }),
    body: {
      required: true,
      content: {
        "application/json": { schema: z.object({ domain: z.string().max(253).nullable() }) },
      },
    },
  },
  responses: {
    200: {
      description: "The study's address now",
      content: { "application/json": { schema: z.object({ participantUrl: z.string() }) } },
    },
    400: errorResponse("That domain isn't one this server offers"),
    401: errorResponse("Not signed in"),
    403: errorResponse("Viewers can't change it"),
    404: errorResponse("No such study on this researcher's teams"),
  },
});

export function createAddressRoutes({
  db,
  participantAppUrl = "http://localhost:5180",
  participantDomains = [],
}: ParticipantRouteDependencies) {
  const app = new OpenAPIHono();

  app.openapi(addressesRoute, async (c) => {
    if (!(await researcherFromRequest(c, db))) {
      return c.json({ error: "Please sign in." }, 401);
    }
    return c.json({ default: participantAppUrl, domains: [...participantDomains] }, 200);
  });

  app.openapi(setAddressRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json({ error: "Please sign in." }, 401);
    }
    const { studyId } = c.req.valid("param");
    const role = await roleOnStudy(db, researcher.id, studyId);
    if (!role) {
      return c.json({ error: "That isn't available." }, 404);
    }
    if (role === "viewer") {
      return c.json({ error: "You can view this study, but not change it." }, 403);
    }
    const domain = c.req.valid("json").domain?.trim().toLowerCase() || null;
    if (domain && !participantDomains.includes(domain)) {
      return c.json({ error: `${domain} isn't one of this Truman's participant domains.` }, 400);
    }
    await db
      .update(schema.studies)
      .set({ participantDomain: domain })
      .where(eq(schema.studies.id, studyId));
    return c.json(
      { participantUrl: studyAddress(domain, participantAppUrl, participantDomains) },
      200,
    );
  });

  return app;
}
