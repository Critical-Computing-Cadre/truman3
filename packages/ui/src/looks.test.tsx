import { cleanup, render, screen } from "@testing-library/react";
import { LAYOUT_KEYS, type LayoutKey, TEMPLATES } from "@truman3/core";
import { afterEach, describe, expect, it } from "vitest";
import { BrandName } from "./BrandName.tsx";
import { CreatePostBar } from "./Composers.tsx";
import { type Chrome, ChromeProvider, SmallPrint } from "./chrome.tsx";
import { PlatformProvider } from "./platform.tsx";

const features = TEMPLATES.classic.features;
const chrome: Chrome = {
  siteName: "Commons",
  viewer: {
    name: "Ann Lee",
    username: "ann",
    pictureUrl: null,
    render: (className, children) => (
      <a href="/u/ann" className={className}>
        {children}
      </a>
    ),
  },
  pages: [
    {
      key: "terms",
      render: (className) => (
        <a href="/terms" className={className}>
          Terms
        </a>
      ),
    },
  ],
};
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
  it.each(LAYOUT_KEYS)("%s: the bar that starts a post has one button named the same", (layout) => {
    render(
      <PlatformProvider platform={inLayout(layout)}>
        <CreatePostBar seed="ann" pictureUrl={null} showPhoto onOpen={() => {}} />
      </PlatformProvider>,
    );
    expect(screen.getByRole("button", { name: "Create a post" })).toBeTruthy();
  });

  it("draws nothing that's only for show in the builder's preview, which has no page around it", () => {
    render(
      <PlatformProvider platform={inLayout("classic")}>
        <CreatePostBar seed="ann" pictureUrl={null} showPhoto onOpen={() => {}} />
        <SmallPrint words={["About", "Help"]} />
      </PlatformProvider>,
    );
    expect(screen.queryByText("Live video")).toBeNull();
    expect(screen.queryByText("About")).toBeNull();
  });

  it("draws what's for show around a real page, marked so it can be told from a real button", () => {
    render(
      <PlatformProvider platform={inLayout("classic")}>
        <ChromeProvider value={chrome}>
          <CreatePostBar seed="ann" pictureUrl={null} showPhoto onOpen={() => {}} />
          <SmallPrint words={["About", "Help"]} />
        </ChromeProvider>
      </PlatformProvider>,
    );
    expect(screen.getByRole("button", { name: "Create a post" }).textContent).toContain("Ann");
    expect(screen.getByText("Live video").closest("button")?.hasAttribute("data-decor")).toBe(true);
    expect(screen.getByText("About").hasAttribute("data-decor")).toBe(true);
    // The study's own pages are real links among them.
    expect(screen.getByRole("link", { name: "Terms" })).toBeTruthy();
    expect(screen.getByText(/Commons © \d{4}/)).toBeTruthy();
  });

  it("leaves it out when a study turns the feature off, and keeps the study's own pages", () => {
    render(
      <PlatformProvider platform={{ layout: "classic", features: { ...features, decor: false } }}>
        <ChromeProvider value={chrome}>
          <CreatePostBar seed="ann" pictureUrl={null} showPhoto onOpen={() => {}} />
          <SmallPrint words={["About", "Help"]} />
        </ChromeProvider>
      </PlatformProvider>,
    );
    expect(screen.queryByText("Live video")).toBeNull();
    expect(screen.queryByText("About")).toBeNull();
    expect(screen.getByRole("link", { name: "Terms" })).toBeTruthy();
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
