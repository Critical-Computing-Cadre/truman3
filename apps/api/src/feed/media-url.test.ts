import { describe, expect, it } from "vitest";
import { mediaUrl } from "./build.ts";

describe("mediaUrl", () => {
  it('with "/", links study images to the page\'s own address, whatever domain it is (ADR 74)', () => {
    expect(mediaUrl("media/eatsnap/p1.jpg", "/")).toBe("/media/eatsnap/p1.jpg");
  });

  it("with an address, links to it, as for local storage", () => {
    expect(mediaUrl("p1.jpg", "http://localhost:8333/truman-media")).toBe(
      "http://localhost:8333/truman-media/p1.jpg",
    );
    expect(mediaUrl("p1.jpg", "http://localhost:8333/truman-media/")).toBe(
      "http://localhost:8333/truman-media/p1.jpg",
    );
  });

  it("leaves full URLs alone, and sends participants' uploads through the API", () => {
    expect(mediaUrl("https://cdn.example.com/a.jpg", "/")).toBe("https://cdn.example.com/a.jpg");
    expect(mediaUrl("uploads/w/p/a.jpg", "/")).toBe("/api/media/uploads/w/p/a.jpg");
  });
});
