import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DECOR_ITEMS, LAYOUT_KEYS, type LayoutKey, TEMPLATES } from "@truman3/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrandName } from "./BrandName.tsx";
import { CreatePostBar } from "./Composers.tsx";
import { type Chrome, ChromeProvider, SmallPrint } from "./chrome.tsx";
import { FeedFrame, PageHeader } from "./PageFrames.tsx";
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
  go: {
    terms: (className, children) => (
      <a href="/terms" className={className}>
        {children}
      </a>
    ),
  },
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
        <SmallPrint />
      </PlatformProvider>,
    );
    expect(screen.queryByText("Live video")).toBeNull();
    expect(screen.queryByText("Advertising")).toBeNull();
  });

  it("says something for show isn't available when it's pressed, and has the press recorded", () => {
    const onDecor = vi.fn();
    render(
      <PlatformProvider platform={inLayout("classic")}>
        <ChromeProvider value={{ ...chrome, onDecor }}>
          <CreatePostBar seed="ann" pictureUrl={null} showPhoto onOpen={() => {}} />
          <SmallPrint />
        </ChromeProvider>
      </PlatformProvider>,
    );
    expect(screen.getByRole("button", { name: "Create a post" }).textContent).toContain("Ann");
    expect(screen.getByText("Live video").closest("button")?.dataset.decor).toBe("live-video");
    expect(screen.getByRole("status").textContent).toBe("");
    fireEvent.click(screen.getByText("Live video"));
    expect(screen.getByRole("status").textContent).toBe(
      "Live video isn't available right now. Please try again later.",
    );
    expect(onDecor).toHaveBeenCalledWith("live-video", "Live video");
    expect(screen.getByText(/Commons © \d{4}/)).toBeTruthy();
  });

  it("opens the study's real page where it has one, and that isn't for show or recorded", () => {
    const onDecor = vi.fn();
    render(
      <PlatformProvider platform={inLayout("classic")}>
        <ChromeProvider value={{ ...chrome, onDecor }}>
          <SmallPrint />
        </ChromeProvider>
      </PlatformProvider>,
    );
    const terms = screen.getByRole("link", { name: "Terms" });
    expect(terms.getAttribute("href")).toBe("/terms");
    expect(terms.hasAttribute("data-decor")).toBe(false);
    // The study has no privacy page, so that one stays for show.
    expect(screen.getByRole("button", { name: "Privacy" }).dataset.decor).toBe("print-privacy");
  });

  it("leaves out what a study hides, and draws what it adds", () => {
    const onDecor = vi.fn();
    const platform = {
      ...inLayout("classic"),
      decor: { hide: ["feeling", "print-cookies"], add: ["Coupons"] },
    };
    render(
      <PlatformProvider platform={platform}>
        <ChromeProvider value={{ ...chrome, onDecor }}>
          <CreatePostBar seed="ann" pictureUrl={null} showPhoto onOpen={() => {}} />
          <FeedFrame renderProfile={() => null}>posts</FeedFrame>
        </ChromeProvider>
      </PlatformProvider>,
    );
    expect(screen.getByText("Live video")).toBeTruthy();
    expect(screen.queryByText("Feeling")).toBeNull();
    expect(screen.queryByText("Cookies")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Coupons" }));
    expect(onDecor).toHaveBeenCalledWith("added-coupons", "Coupons");
  });

  it("leaves it all out when a study turns the feature off, and keeps the study's own pages", () => {
    render(
      <PlatformProvider platform={{ layout: "classic", features: { ...features, decor: false } }}>
        <ChromeProvider value={chrome}>
          <CreatePostBar seed="ann" pictureUrl={null} showPhoto onOpen={() => {}} />
          <SmallPrint />
        </ChromeProvider>
      </PlatformProvider>,
    );
    expect(screen.queryByText("Live video")).toBeNull();
    expect(screen.queryByText("Advertising")).toBeNull();
    expect(screen.getByRole("link", { name: "Terms" })).toBeTruthy();
  });

  // The builder offers this list to hide from, so it has to be what's really drawn.
  it.each(LAYOUT_KEYS)("%s: draws exactly the for-show things its list says it has", (layout) => {
    const link = {
      key: "home",
      label: "Home",
      render: (c: string) => (
        <a href="/" className={c}>
          Home
        </a>
      ),
    };
    const { container } = render(
      <PlatformProvider platform={inLayout(layout)}>
        <ChromeProvider value={{ ...chrome, go: {} }}>
          <PageHeader renderBrand={() => null} home={link} links={[]} />
          <CreatePostBar seed="ann" pictureUrl={null} showPhoto onOpen={() => {}} />
          <FeedFrame renderProfile={() => null}>posts</FeedFrame>
        </ChromeProvider>
      </PlatformProvider>,
    );
    const drawn = new Set(
      [...container.querySelectorAll<HTMLElement>("[data-decor]")].map((el) => el.dataset.decor),
    );
    // The search box and Contacts are for show without being buttons, so they carry no mark.
    const listed = DECOR_ITEMS[layout]
      .map(({ key }) => key)
      .filter((key) => !["search", "contacts"].includes(key));
    expect([...drawn].sort()).toEqual([...listed].sort());
    expect(container.querySelector('input[type="search"]') !== null).toBe(
      DECOR_ITEMS[layout].some(({ key }) => key === "search"),
    );
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
