import { cleanup, render, screen } from "@testing-library/react";
import { LAYOUT_KEYS, type LayoutKey, TEMPLATES } from "@truman3/core";
import { afterEach, describe, expect, it } from "vitest";
import { BrandName } from "./BrandName.tsx";
import { CreatePostBar } from "./Composers.tsx";
import { PlatformProvider } from "./platform.tsx";

const features = TEMPLATES.classic.features;
const inLayout = (layout: LayoutKey, accent?: string) => ({
  layout,
  features,
  ...(accent ? { accent } : {}),
});

describe("what makes each kind of site look like itself", () => {
  afterEach(cleanup);

  it.each(LAYOUT_KEYS)("%s: everything inside takes its colors", (layout) => {
    const { container } = render(
      <PlatformProvider platform={inLayout(layout)}>
        <p>Inside</p>
      </PlatformProvider>,
    );
    expect(container.querySelector(`[data-layout="${layout}"]`)?.textContent).toBe("Inside");
  });

  it("a study's own color goes where its layout's would", () => {
    const { container } = render(
      <PlatformProvider platform={inLayout("photo", "#225588")}>
        <p>Inside</p>
      </PlatformProvider>,
    );
    const skin = container.querySelector<HTMLElement>('[data-layout="photo"]');
    expect(skin?.style.getPropertyValue("--accent-base")).toBe("#225588");
    expect(skin?.style.getPropertyValue("--color-on-accent")).toBe("#ffffff");
  });

  // Tests and screen readers find it by one name, whatever a layout writes on it.
  it.each(LAYOUT_KEYS)("%s: the bar that starts a post is one button, named the same", (layout) => {
    render(
      <PlatformProvider platform={inLayout(layout)}>
        <CreatePostBar seed="ann" pictureUrl={null} showPhoto onOpen={() => {}} />
      </PlatformProvider>,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Create a post" })).toBeTruthy();
  });

  it.each(LAYOUT_KEYS)("%s: the site's name is written out, once", (layout) => {
    render(
      <PlatformProvider platform={inLayout(layout)}>
        <a href="/">
          <BrandName name="Commons" />
        </a>
      </PlatformProvider>,
    );
    // A mark beside it is hidden from a screen reader, so the link's name is only the name.
    expect(screen.getByRole("link", { name: "Commons" })).toBeTruthy();
  });
});
