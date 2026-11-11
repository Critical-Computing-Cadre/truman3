/**
 * Talks to a Truman server's admin API for an agent, with a researcher's personal access token. The
 * server decides what the token may do (ADR 64), so this only passes requests along and says
 * plainly what came back.
 */

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface TrumanClient {
  /** A request to the admin API, like ("GET", "/admin/studies"). Throws with the server's message. */
  call<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
}

export class TrumanError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function trumanClient({
  baseUrl,
  token,
  fetch: send = fetch,
}: {
  /** The server's address, like https://truman.example.edu. */
  baseUrl: string;
  token: string;
  fetch?: Fetch;
}): TrumanClient {
  const root = baseUrl.replace(/\/+$/, "");
  return {
    async call<T>(method: string, path: string, body?: unknown): Promise<T> {
      if (!path.startsWith("/admin/")) {
        throw new TrumanError(400, "Only the admin API, under /admin/, can be reached from here.");
      }
      const response = await send(`${root}/api${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (!response.ok) {
        const error =
          json && typeof json === "object" && "error" in json ? String(json.error) : text;
        throw new TrumanError(
          response.status,
          response.status === 401
            ? "The token didn't work. It may have expired or been revoked; make a new one on the admin app's Access for agents page."
            : error || `The server answered ${response.status}.`,
        );
      }
      return json as T;
    },
  };
}
