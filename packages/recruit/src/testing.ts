import type { ProlificSubmission } from "./prolific.ts";

const PAGE_SIZE = 2;

interface FakeStudy {
  id: string;
  owner: string;
  body: Record<string, unknown>;
  submissions: ProlificSubmission[];
}

/**
 * A stand-in for Prolific's API, built from its documentation. It shows the code matches how the
 * docs read, which is not the same as working against the real thing. Each token is one person, and
 * they can only reach their own studies, as they would on Prolific.
 */
export function createFakeProlific({ tokens = ["good-token"] }: { tokens?: string[] } = {}) {
  const studies = new Map<string, FakeStudy>();
  const approved: string[] = [];
  const bonuses = new Map<string, { studyId: string; csv: string; paid: number }>();
  const requests: { method: string; path: string; authorization: string | null }[] = [];
  let nextId = 1;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const problem = (status: number, detail: string) =>
    json({ error: { status, title: "Error", detail } }, status);

  const addSubmission = (studyId: string, submission: Partial<ProlificSubmission> = {}) => {
    const study = studies.get(studyId);
    if (!study) {
      throw new Error(`There's no fake study ${studyId}.`);
    }
    const added: ProlificSubmission = {
      id: `sub-${nextId++}`,
      participant_id: `pid-${nextId++}`,
      status: "AWAITING REVIEW",
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      study_code: null,
      ...submission,
    };
    study.submissions.push(added);
    return added;
  };

  const handle = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const authorization = headers.get("authorization");
    requests.push({ method, path: url.pathname, authorization });
    const token = authorization?.replace(/^Token /, "") ?? "";
    if (!tokens.includes(token)) {
      return problem(401, "Invalid token.");
    }
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const route = url.pathname.replace(/^\/api\/v1/, "");

    if (method === "GET" && route === "/users/me/") {
      return json({ id: `user-${token}`, first_name: "Pat", display_name: "Pat Researcher" });
    }
    if (method === "GET" && route === "/workspaces/") {
      return json({ results: [{ id: "ws-1", title: "The Lab" }], _links: { next: null } });
    }
    const match1 = route.match(/^\/workspaces\/([^/]+)\/projects\/$/);
    if (method === "GET" && match1) {
      return json({
        results: [{ id: `project-${match1[1]}`, title: "Project One" }],
        _links: { next: null },
      });
    }
    if (method === "POST" && route === "/studies/") {
      const required = [
        "name",
        "description",
        "external_study_url",
        "prolific_id_option",
        "total_available_places",
        "estimated_completion_time",
        "reward",
      ];
      const missing = required.filter((field) => body[field] === undefined || body[field] === "");
      if (missing.length > 0) {
        return problem(400, `Missing: ${missing.join(", ")}`);
      }
      if (Number(body.reward) < 10) {
        return problem(400, "The reward is too low.");
      }
      const id = `study-${nextId++}`;
      studies.set(id, { id, owner: token, body, submissions: [] });
      return json({ id, status: "UNPUBLISHED" }, 201);
    }
    const match2 = route.match(/^\/studies\/([^/]+)\/$/);
    if (method === "GET" && match2) {
      const study = studies.get(match2[1] ?? "");
      return study?.owner === token
        ? json({ id: study.id, name: study.body.name, status: "UNPUBLISHED" })
        : problem(404, "Not found.");
    }
    const match3 = route.match(/^\/studies\/([^/]+)\/submissions\/$/);
    if (method === "GET" && match3) {
      const study = studies.get(match3[1] ?? "");
      if (study?.owner !== token) {
        return problem(403, "You can't see this study.");
      }
      const page = Number(url.searchParams.get("page") ?? "1");
      const start = (page - 1) * PAGE_SIZE;
      const hasMore = study.submissions.length > start + PAGE_SIZE;
      return json({
        results: study.submissions.slice(start, start + PAGE_SIZE),
        _links: {
          next: hasMore ? { href: `${url.origin}${url.pathname}?page=${page + 1}` } : null,
        },
      });
    }
    if (method === "POST" && route === "/submissions/bulk-approve/") {
      const ids = body.submission_ids as string[];
      approved.push(...ids);
      for (const study of studies.values()) {
        for (const submission of study.submissions) {
          if (ids.includes(submission.id)) {
            submission.status = "APPROVED";
          }
        }
      }
      return new Response("The request to bulk approve has been made successfully.");
    }
    if (method === "POST" && route === "/submissions/bonus-payments/") {
      const csv = String(body.csv_bonuses);
      const total = csv
        .split("\n")
        .reduce((sum, line) => sum + Number(line.split(",")[1] ?? 0) * 100, 0);
      const id = `bonus-${nextId++}`;
      bonuses.set(id, { studyId: String(body.study_id), csv, paid: 0 });
      return json({ id, amount: total, fees: 10, vat: 0, total_amount: total + 10 }, 201);
    }
    const match4 = route.match(/^\/bulk-bonus-payments\/([^/]+)\/pay\/$/);
    if (method === "POST" && match4) {
      const bonus = bonuses.get(match4[1] ?? "");
      if (!bonus) {
        return problem(404, "Not found.");
      }
      bonus.paid += 1;
      return new Response("Scheduled.", { status: 202 });
    }
    return problem(404, `The fake has no ${method} ${route}.`);
  };

  return { fetch: handle as typeof fetch, studies, approved, bonuses, requests, addSubmission };
}
