import { describe, expect, it } from "vitest";
import { joinPathFrom } from "./join-link.ts";

/** In Truman's app, someone who isn't in a study yet pastes the link they were given. */
describe("a pasted study link", () => {
  it("is found in a whole link, keeping the recruitment ID", () => {
    expect(joinPathFrom("https://truman.example.edu/join/bystander?PROLIFIC_PID=abc123")).toBe(
      "/join/bystander?PROLIFIC_PID=abc123",
    );
  });

  it("is found in the app's own kind of link, and in a bare path", () => {
    expect(joinPathFrom("commons://join/bystander?id=7")).toBe("/join/bystander?id=7");
    expect(joinPathFrom("  /join/try-eatsnap/ ")).toBe("/join/try-eatsnap");
    expect(joinPathFrom("join/eatsnap")).toBe("/join/eatsnap");
  });

  it("never leads off this site, whatever address the link had", () => {
    expect(joinPathFrom("https://elsewhere.example/join/x?next=https://evil.example")).toBe(
      "/join/x?next=https://evil.example",
    );
    expect(joinPathFrom("https://elsewhere.example/join/x")?.startsWith("/join/")).toBe(true);
  });

  it("isn't found in anything else", () => {
    expect(joinPathFrom("")).toBeNull();
    expect(joinPathFrom("https://truman.example.edu/")).toBeNull();
    expect(joinPathFrom("https://truman.example.edu/rejoin/now")).toBeNull();
    expect(joinPathFrom("please let me join/ the study")).toBeNull();
  });
});
