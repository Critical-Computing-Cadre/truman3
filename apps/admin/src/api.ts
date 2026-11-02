import type { FeedResponse } from "@truman3/core";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      response.status,
      (body as { error?: string }).error ?? "Something went wrong.",
    );
  }
  return body as T;
}

export async function get<T>(path: string): Promise<T> {
  return parse<T>(await fetch(`/api${path}`));
}

export async function send<T>(method: string, path: string, body?: object): Promise<T> {
  return parse<T>(
    await fetch(`/api${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
}

export async function post<T>(path: string, body: object = {}): Promise<T> {
  return parse<T>(
    await fetch(`/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export interface Researcher {
  name: string;
  email: string;
  teams: { name: string; role: string }[];
}

export interface StudySummary {
  id: string;
  slug: string;
  team: string;
  participants: number;
  role: string;
  openDraftId: string | null;
  versions: { id: string; version: number; title: string; frozenAt: string | null }[];
}

export interface PreviewInfo {
  title: string;
  slug: string;
  version: number;
  siteName: string;
  siteLogoUrl: string | null;
  lengthMs: number;
  conditions: {
    key: string;
    ranker: string;
    windowHours: number | null;
    platformStyle: string;
  }[];
  posts: { offsetMs: number; conditions: string[] }[];
}

export interface PreviewResponse extends FeedResponse {
  /** Which conditions each post or comment is limited to. Absent means all of them. */
  targeting: Record<string, string[]>;
}

export interface DraftInfo {
  title: string;
  slug: string;
  canEdit: boolean;
  closed: boolean;
  lengthMs: number;
  conditions: PreviewInfo["conditions"];
  actors: { id: string; username: string; name: string }[];
  posts: PreviewInfo["posts"];
  issues: { severity: "error" | "warning"; message: string }[];
}

export interface DraftItemDetails {
  actorId: string;
  timeMs: number;
  conditions: string[];
  likes: number;
  origin: string;
}

export interface DraftPreviewResponse extends PreviewResponse {
  items: Record<string, DraftItemDetails>;
}
