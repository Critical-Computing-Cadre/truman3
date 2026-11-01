import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiStatus } from "./ApiStatus.tsx";

function respondWith(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body))),
  );
}

describe("ApiStatus", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows connected when the API reports ok", async () => {
    respondWith({ status: "ok" });
    render(<ApiStatus />);

    expect(await screen.findByText("API connected")).toBeTruthy();
  });

  it("shows unreachable when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    render(<ApiStatus />);

    expect(await screen.findByText("API unreachable")).toBeTruthy();
  });

  it("shows unreachable when the response isn't what the API should send", async () => {
    respondWith({ status: "nope" });
    render(<ApiStatus />);

    expect(await screen.findByText("API unreachable")).toBeTruthy();
  });
});
