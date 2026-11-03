import { randomBytes } from "node:crypto";

export const PROLIFIC_API_URL = "https://api.prolific.com";
const COMPLETE_URL = "https://app.prolific.com/submissions/complete";
const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 10;
/** Prolific's recommended limits for one request. */
export const APPROVALS_PER_REQUEST = 1000;
export const BONUSES_PER_REQUEST = 200;

export class ProlificError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** How a finished person gets approved. */
export type ReviewMode = "manual" | "automatic";

export interface CompletionCodes {
  /** For someone finished. With automatic review, this one pays them right away. */
  finished: string;
  /** With automatic review, for someone who didn't meet the study's rules. */
  needsReview?: string;
  declined: string;
}

export interface ProlificSubmission {
  id: string;
  participant_id: string;
  status: string;
  started_at: string;
  completed_at?: string | null;
  study_code?: string | null;
}

export interface DraftInput {
  name: string;
  description: string;
  externalStudyUrl: string;
  project: string;
  places: number;
  minutes: number;
  /** In the smallest unit of the currency, such as cents. */
  reward: number;
  reviewMode: ReviewMode;
  codes: CompletionCodes;
}

export interface BonusSetup {
  id: string;
  /** As Prolific reports them, in the smallest unit of the currency. */
  amount: number;
  fees: number;
  vat: number;
  totalAmount: number;
}

const code = () =>
  Array.from(randomBytes(CODE_LENGTH), (byte) => CODE_LETTERS[byte % CODE_LETTERS.length]).join("");

/** New codes for a draft. Prolific only recognizes these for this one study. */
export function newCompletionCodes(reviewMode: ReviewMode): CompletionCodes {
  return {
    finished: code(),
    ...(reviewMode === "automatic" ? { needsReview: code() } : {}),
    declined: code(),
  };
}

/** Where to send someone so Prolific records them as done. */
export function completionUrl(completionCode: string): string {
  return `${COMPLETE_URL}?cc=${encodeURIComponent(completionCode)}`;
}

/** The link Prolific sends people to, with Prolific filling in the placeholders for each person. */
export function entryUrl(participantAppUrl: string, slug: string, idParam: string): string {
  const base = participantAppUrl.replace(/\/+$/, "");
  return `${base}/join/${slug}?${idParam}={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}`;
}

function completionCodesFor({ reviewMode, codes }: DraftInput) {
  return [
    {
      code: codes.finished,
      code_type: "COMPLETED",
      actions: [
        { action: reviewMode === "automatic" ? "AUTOMATICALLY_APPROVE" : "MANUALLY_REVIEW" },
      ],
    },
    ...(codes.needsReview
      ? [{ code: codes.needsReview, code_type: "OTHER", actions: [{ action: "MANUALLY_REVIEW" }] }]
      : []),
    {
      code: codes.declined,
      code_type: "NO_CONSENT",
      actions: [{ action: "REQUEST_RETURN", return_reason: "Did not consent" }],
    },
  ];
}

function errorMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const outer = body as { error?: unknown; detail?: unknown; title?: unknown };
  const found = outer.error && typeof outer.error === "object" ? outer.error : outer;
  const { detail, title } = found as { detail?: unknown; title?: unknown };
  const message = detail ?? title ?? (typeof outer.error === "string" ? outer.error : null);
  if (message === null || message === undefined) {
    return null;
  }
  return typeof message === "string" ? message : JSON.stringify(message);
}

/**
 * Talks to Prolific as one person, with their token, so Prolific decides what they're allowed to
 * do (ADR 17). Nothing here publishes a study, since that's the step that spends money on people.
 */
export function createProlificClient({
  token,
  apiUrl = PROLIFIC_API_URL,
  fetch: send = fetch,
}: {
  token: string;
  apiUrl?: string;
  fetch?: typeof fetch;
}) {
  const base = apiUrl.replace(/\/+$/, "");

  const request = async <T>(method: string, path: string, body?: object): Promise<T> => {
    const response = await send(`${base}${path}`, {
      method,
      headers: {
        authorization: `Token ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Some of Prolific's answers are plain text.
    }
    if (!response.ok) {
      throw new ProlificError(
        response.status,
        errorMessage(parsed) ?? `Prolific answered with an error (${response.status}).`,
      );
    }
    return parsed as T;
  };

  /** Follows every page. Only the path is reused, so the token can't be sent anywhere else. */
  const listAll = async <T>(firstPath: string): Promise<T[]> => {
    const items: T[] = [];
    let path: string | null = firstPath;
    while (path) {
      const page: { results: T[]; _links?: { next?: { href?: string | null } | null } } =
        await request("GET", path);
      items.push(...page.results);
      const next = page._links?.next?.href;
      const url = next ? new URL(next, base) : null;
      path = url ? `${url.pathname}${url.search}` : null;
    }
    return items;
  };

  return {
    me: () =>
      request<{ id: string; first_name?: string; display_name?: string }>(
        "GET",
        "/api/v1/users/me/",
      ),

    /** Every project this person can reach, across all their workspaces. */
    projects: async () => {
      const workspaces = await listAll<{ id: string; title: string }>("/api/v1/workspaces/");
      const lists = await Promise.all(
        workspaces.map(async (workspace) => {
          const projects = await listAll<{ id: string; title: string }>(
            `/api/v1/workspaces/${workspace.id}/projects/`,
          );
          return projects.map(({ id, title }) => ({ id, title, workspace: workspace.title }));
        }),
      );
      return lists.flat();
    },

    /** Creates an unpublished draft. Publishing happens on Prolific, by a person. */
    createDraft: (input: DraftInput) =>
      request<{ id: string; status?: string }>("POST", "/api/v1/studies/", {
        name: input.name,
        description: input.description,
        external_study_url: input.externalStudyUrl,
        prolific_id_option: "url_parameters",
        completion_codes: completionCodesFor(input),
        total_available_places: input.places,
        estimated_completion_time: input.minutes,
        reward: input.reward,
        project: input.project,
      }),

    study: (id: string) =>
      request<{ id: string; name?: string; status?: string }>("GET", `/api/v1/studies/${id}/`),

    submissions: (studyId: string) =>
      listAll<ProlificSubmission>(`/api/v1/studies/${studyId}/submissions/`),

    /** Prolific does this in the background, so success means it has been accepted. */
    approve: async (submissionIds: readonly string[]) => {
      for (let start = 0; start < submissionIds.length; start += APPROVALS_PER_REQUEST) {
        await request("POST", "/api/v1/submissions/bulk-approve/", {
          submission_ids: submissionIds.slice(start, start + APPROVALS_PER_REQUEST),
        });
      }
    },

    /** Sets up a bonus and says what it'll cost. This doesn't pay anyone yet. */
    setUpBonus: async (
      studyId: string,
      bonuses: readonly { submissionId: string; amount: number }[],
    ): Promise<BonusSetup> => {
      const created = await request<{
        id: string;
        amount?: number;
        fees?: number;
        vat?: number;
        total_amount?: number;
      }>("POST", "/api/v1/submissions/bonus-payments/", {
        study_id: studyId,
        csv_bonuses: bonuses
          .map(({ submissionId, amount }) => `${submissionId},${amount.toFixed(2)}`)
          .join("\n"),
      });
      return {
        id: created.id,
        amount: created.amount ?? 0,
        fees: created.fees ?? 0,
        vat: created.vat ?? 0,
        totalAmount: created.total_amount ?? 0,
      };
    },

    /** Prolific warns that repeating this call pays people again, so call it once per bonus. */
    payBonus: (bonusId: string) =>
      request("POST", `/api/v1/bulk-bonus-payments/${bonusId}/pay/`, {}),
  };
}

export type ProlificClient = ReturnType<typeof createProlificClient>;
