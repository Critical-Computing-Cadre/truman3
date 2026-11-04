import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type FeatureKey, type FeedPost, TEMPLATES } from "@truman3/core";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeedPostView } from "./FeedPostView.tsx";
import { PlatformProvider } from "./platform.tsx";
import type { FeedPostViewProps } from "./post-props.ts";

const author = { username: "ann", name: "Ann", pictureUrl: null, isViewer: false };

const POST: FeedPost = {
  id: "p1",
  author,
  body: "A post",
  attachments: [],
  at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  likes: 3,
  liked: false,
  ups: 0,
  downs: 0,
  vote: null,
  flagged: false,
  commentCount: 0,
  comments: [
    {
      id: "c1",
      depth: 0,
      author,
      body: "A comment",
      at: new Date().toISOString(),
      likes: 0,
      liked: false,
      ups: 0,
      downs: 0,
      vote: null,
      flagged: false,
    },
  ],
};

describe("FeedPostView", () => {
  afterEach(cleanup);

  it("shows the post, its time, its likes, and its comments", () => {
    render(<FeedPostView post={POST} />);

    expect(screen.getByText("A post")).toBeTruthy();
    expect(screen.getByText("2h")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Like \(3\)/ })).toBeTruthy();
    expect(screen.getByText("A comment")).toBeTruthy();
  });

  it("looks the same but can't be acted on without actions, as in a preview", () => {
    render(<FeedPostView post={POST} />);

    for (const button of screen.getAllByRole("button")) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("reports actions when they're provided", () => {
    const actions = { onLike: vi.fn(), onVote: vi.fn(), onFlag: vi.fn(), onReply: vi.fn() };
    render(<FeedPostView post={POST} actions={actions} />);

    fireEvent.click(screen.getByRole("button", { name: /Like \(3\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));

    expect(actions.onLike).toHaveBeenCalledWith("p1", true);
    expect(actions.onReply).toHaveBeenCalled();
  });

  it("covers a flagged post, with a way to undo it", () => {
    const actions = { onLike: vi.fn(), onVote: vi.fn(), onFlag: vi.fn(), onReply: vi.fn() };
    render(<FeedPostView post={{ ...POST, flagged: true }} actions={actions} />);

    expect(screen.getByText("You've flagged this!")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Unflag" }));
    expect(actions.onFlag).toHaveBeenCalledWith("p1", false);
  });

  it("can show a note on posts and comments, for the admin app", () => {
    render(<FeedPostView post={POST} renderNote={(id) => <em>note for {id}</em>} />);

    expect(screen.getByText("note for p1")).toBeTruthy();
    expect(screen.getByText("note for c1")).toBeTruthy();
  });
});

describe("the forum layout", () => {
  afterEach(cleanup);

  const forum = (props: Partial<FeedPostViewProps> = {}, post: Partial<FeedPost> = {}) => (
    <PlatformProvider platform={{ layout: "forum", features: TEMPLATES.forum.features }}>
      <FeedPostView
        post={{
          ...POST,
          title: "A title",
          commentCount: 3,
          author: { ...author, karma: 1200 },
          space: { key: "cooking", name: "Cooking" },
          ...post,
        }}
        {...props}
      />
    </PlatformProvider>
  );
  const link = (_id: string, className: string, children: ReactNode) => (
    <a href="/post" className={className}>
      {children}
    </a>
  );

  it("shows its title, community, karma, votes, and a link to its comments", () => {
    render(forum({ renderPostLink: link }, { comments: [] }));

    expect(screen.getByRole("article", { name: "A title" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "A title" })).toBeTruthy();
    expect(screen.getByTestId("post-space").textContent).toContain("Cooking");
    expect(screen.getByTestId("karma").textContent).toBe("1,200 karma");
    expect(screen.getByRole("button", { name: "Vote up" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "3 comments" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Like/ })).toBeNull();
  });

  it("doesn't cut its text short, or link to itself, on its own page", () => {
    render(forum({ renderPostLink: link, detail: true }));

    expect(screen.queryByRole("link", { name: "A title" })).toBeNull();
    expect(screen.queryByRole("link", { name: "3 comments" })).toBeNull();
    expect(screen.getByText("A post").className).not.toContain("line-clamp");
    expect(screen.getByText("A comment")).toBeTruthy();
  });

  it("loses what a study turns off, the same as Classic", () => {
    render(
      <PlatformProvider
        platform={{
          layout: "forum",
          features: {
            ...TEMPLATES.forum.features,
            votes: false,
            spaces: false,
            titles: false,
            karma: false,
            flagging: false,
            postPages: false,
          },
        }}
      >
        <FeedPostView
          post={{
            ...POST,
            title: "A title",
            author: { ...author, karma: 5 },
            space: { key: "cooking", name: "Cooking" },
          }}
          renderPostLink={link}
        />
      </PlatformProvider>,
    );

    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByTestId("post-space")).toBeNull();
    expect(screen.queryByTestId("karma")).toBeNull();
    expect(screen.queryByRole("button", { name: "Vote up" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Flag" })).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    // Comments that the server sends still show, since where they go is up to the feature.
    expect(screen.getByText("A comment")).toBeTruthy();
  });
});

describe("Classic with forum features turned on", () => {
  afterEach(cleanup);

  it("takes titles, karma, and a page for each post, with no changes to its own arrangement", () => {
    render(
      <PlatformProvider
        platform={{
          layout: "classic",
          features: { ...TEMPLATES.classic.features, titles: true, karma: true, postPages: true },
        }}
      >
        <FeedPostView
          post={{ ...POST, title: "A title", commentCount: 1, author: { ...author, karma: 7 } }}
          renderPostLink={(_id, className, children) => (
            <a href="/post" className={className}>
              {children}
            </a>
          )}
        />
      </PlatformProvider>,
    );

    expect(screen.getByRole("link", { name: "A title" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "1 comment" })).toBeTruthy();
    expect(screen.getAllByTestId("karma").length).toBeGreaterThan(0);
  });

  it("shows none of them on Classic as it is", () => {
    render(<FeedPostView post={{ ...POST, title: "A title", author: { ...author, karma: 7 } }} />);

    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByTestId("karma")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("features", () => {
  afterEach(cleanup);

  const withFeatures = (off: Partial<Record<FeatureKey, boolean>>) => (
    <PlatformProvider
      platform={{
        layout: "classic",
        features: { ...TEMPLATES.classic.features, ...off },
      }}
    >
      <FeedPostView post={POST} belowComments={<p>A comment box</p>} />
    </PlatformProvider>
  );

  it("shows everything on the Classic template, without being told", () => {
    render(<FeedPostView post={POST} />);
    for (const name of ["Reply", "Flag", /Like/]) {
      expect(screen.getAllByRole("button", { name }).length).toBeGreaterThan(0);
    }
  });

  it("removes the likes feature from posts and comments", () => {
    render(withFeatures({ likes: false }));
    expect(screen.queryByRole("button", { name: /Like/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Flag" }).length).toBeGreaterThan(0);
  });

  it("removes the flagging feature", () => {
    render(withFeatures({ flagging: false }));
    expect(screen.queryByRole("button", { name: "Flag" })).toBeNull();
  });

  it("removes the comments feature, with the box and Reply button", () => {
    render(withFeatures({ comments: false }));
    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
    expect(screen.queryByText("A comment box")).toBeNull();
  });

  it("drops the row of buttons when nothing's left in it", () => {
    render(withFeatures({ comments: false, likes: false, flagging: false }));
    expect(screen.queryAllByRole("button")).toEqual([]);
  });
});

describe("replies to replies", () => {
  afterEach(cleanup);

  const withThreads = (threads: boolean, onReplyTo = vi.fn()) => {
    const comment = POST.comments[0] as FeedPost["comments"][number];
    render(
      <PlatformProvider
        platform={{
          layout: "classic",
          features: { ...TEMPLATES.classic.features, threads },
        }}
      >
        <FeedPostView
          post={{ ...POST, comments: [comment, { ...comment, id: "c2", body: "Below", depth: 2 }] }}
          actions={{
            onLike: vi.fn(),
            onVote: vi.fn(),
            onFlag: vi.fn(),
            onReply: vi.fn(),
            onReplyTo,
          }}
        />
      </PlatformProvider>,
    );
    return onReplyTo;
  };

  it("offers a reply on each comment when threads are on, and passes on which one", () => {
    const onReplyTo = withThreads(true);
    // One for the post, and one for each comment.
    const buttons = screen.getAllByRole("button", { name: "Reply" });
    expect(buttons).toHaveLength(3);
    fireEvent.click(buttons[2] as HTMLElement);
    expect(onReplyTo.mock.calls[0]?.[0]).toMatchObject({ id: "c2" });
  });

  it("offers no reply on comments when threads are off", () => {
    withThreads(false);
    expect(screen.getAllByRole("button", { name: "Reply" })).toHaveLength(1);
  });

  it("indents a comment by how far down it is", () => {
    withThreads(true);
    expect(screen.getByText("Below").closest("li")?.style.marginLeft).toBe("2.5rem");
    expect(screen.getByText("A comment").closest("li")?.style.marginLeft).toBe("");
  });
});

describe("votes", () => {
  afterEach(cleanup);

  const withVotes = (votes: boolean, onVote = vi.fn()) => {
    const voted = { ...POST, ups: 7, downs: 2, vote: "up" as const };
    render(
      <PlatformProvider
        platform={{ layout: "classic", features: { ...TEMPLATES.classic.features, votes } }}
      >
        <FeedPostView
          post={voted}
          actions={{ onLike: vi.fn(), onVote, onFlag: vi.fn(), onReply: vi.fn() }}
        />
      </PlatformProvider>,
    );
    return onVote;
  };

  it("doesn't show when the feature's off, as in Classic", () => {
    withVotes(false);
    expect(screen.queryByRole("button", { name: "Vote up" })).toBeNull();
  });

  it("shows the score, and says which way this viewer voted", () => {
    withVotes(true);
    expect(screen.getAllByTestId("score")[0]?.textContent).toBe("Score 5");
    const up = screen.getAllByRole("button", { name: "Vote up" })[0] as HTMLElement;
    expect(up.getAttribute("aria-pressed")).toBe("true");
  });

  it("changes a vote, or takes it back when it's pressed again", () => {
    const onVote = withVotes(true);
    fireEvent.click(screen.getAllByRole("button", { name: "Vote down" })[0] as HTMLElement);
    expect(onVote).toHaveBeenLastCalledWith("p1", "down");
    fireEvent.click(screen.getAllByRole("button", { name: "Vote up" })[0] as HTMLElement);
    expect(onVote).toHaveBeenLastCalledWith("p1", null);
  });
});

describe("photos", () => {
  afterEach(cleanup);
  const url = (name: string) => ({ type: "image" as const, url: `https://cdn.test/${name}` });

  const withGalleries = (galleries: boolean) =>
    render(
      <PlatformProvider
        platform={{ layout: "classic", features: { ...TEMPLATES.classic.features, galleries } }}
      >
        <FeedPostView post={{ ...POST, attachments: [url("a.jpg"), url("b.jpg")] }} />
      </PlatformProvider>,
    );

  it("shows only the first photo without galleries", () => {
    const { container } = withGalleries(false);
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(screen.queryByText("1 of 2")).toBeNull();
  });

  it("shows every photo with galleries, and says how many", () => {
    const { container } = withGalleries(true);
    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(screen.getByText("2 of 2")).toBeTruthy();
    expect(screen.getByRole("region", { name: "2 photos" })).toBeTruthy();
  });
});

describe("spaces and moderators", () => {
  afterEach(cleanup);
  const inSpace: FeedPost = { ...POST, space: { key: "cooking", name: "Cooking" } };
  const withFeature = (spaces: boolean) => ({
    layout: "classic" as const,
    features: { ...TEMPLATES.classic.features, spaces },
  });

  it("names the space when the feature's on, and links it if told how", () => {
    render(
      <PlatformProvider platform={withFeature(true)}>
        <FeedPostView
          post={inSpace}
          renderSpace={(_key, _class, name) => <a href="/x">{name}</a>}
        />
      </PlatformProvider>,
    );
    expect(screen.getByRole("link", { name: "Cooking" })).toBeTruthy();
  });

  it("shows no space when the feature's off", () => {
    render(
      <PlatformProvider platform={withFeature(false)}>
        <FeedPostView post={inSpace} />
      </PlatformProvider>,
    );
    expect(screen.queryByText("Cooking")).toBeNull();
  });

  it("tags a moderator, with or without spaces, and nobody else", () => {
    render(<FeedPostView post={{ ...POST, author: { ...author, moderator: true } }} />);
    expect(screen.getAllByText("Moderator")).toHaveLength(1);
  });
});

describe("what forum features add to a post", () => {
  afterEach(cleanup);

  const FORUM = TEMPLATES.forum;
  const all = { ...FORUM.features, adultTags: true };
  const inPlatform = (
    layout: "classic" | "forum",
    features: typeof all,
    props: FeedPostViewProps,
  ) =>
    render(
      <PlatformProvider platform={{ layout, features }}>
        <FeedPostView {...props} />
      </PlatformProvider>,
    );
  const none = Object.fromEntries(Object.keys(all).map((key) => [key, false])) as typeof all;

  it.each(["classic", "forum"] as const)("shows none of it when it's off, in %s", (layout) => {
    inPlatform(layout, none, { post: POST });
    for (const name of ["Save", "Saved", "Hide", "Unhide", "Share"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByText("Pinned")).toBeNull();
    expect(screen.queryByText("Locked")).toBeNull();
  });

  it.each(["classic", "forum"] as const)("draws all of it from the features, in %s", (layout) => {
    const onSave = vi.fn();
    const onHide = vi.fn();
    const onOpenLink = vi.fn();
    const onReveal = vi.fn();
    const post: FeedPost = {
      ...POST,
      pinned: true,
      locked: true,
      link: { url: "https://example.org/a", domain: "example.org" },
    };
    const actions = {
      onLike: vi.fn(),
      onVote: vi.fn(),
      onFlag: vi.fn(),
      onReply: vi.fn(),
      onSave,
      onHide,
      onOpenLink,
      onReveal,
    };
    inPlatform(layout, all, { post, actions });
    expect(screen.getByText("Pinned")).toBeDefined();
    expect(screen.getByText("Locked")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();

    const link = screen.getByRole("link", { name: /example\.org/ });
    expect(link.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    fireEvent.click(link);
    expect(onOpenLink).toHaveBeenCalledWith("p1");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith("p1", true);
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(onHide).toHaveBeenCalledWith("p1", true);
  });

  it.each(["classic", "forum"] as const)(
    "covers a tagged post until it's clicked, in %s",
    (layout) => {
      const onReveal = vi.fn();
      const post: FeedPost = { ...POST, tags: ["spoiler", "adult"] };
      inPlatform(layout, all, {
        post,
        actions: { onLike: vi.fn(), onVote: vi.fn(), onFlag: vi.fn(), onReply: vi.fn(), onReveal },
      });
      expect(screen.queryByText("A post")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /Spoiler, Adult content/ }));
      expect(screen.getByText("A post")).toBeDefined();
      expect(onReveal).toHaveBeenCalledWith("p1");
    },
  );

  it("doesn't cover a tagged post for someone editing it", () => {
    inPlatform("forum", all, {
      post: { ...POST, tags: ["spoiler"] },
      renderBody: (_id, body) => <span>{body}</span>,
    });
    expect(screen.getByText("A post")).toBeDefined();
  });

  it("says a shared link was copied, or that it wasn't", async () => {
    const onShare = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    inPlatform("forum", all, {
      post: POST,
      actions: { onLike: vi.fn(), onVote: vi.fn(), onFlag: vi.fn(), onReply: vi.fn(), onShare },
    });
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    fireEvent.click(await screen.findByRole("button", { name: "Link copied" }));
    expect(await screen.findByRole("button", { name: "Couldn't copy" })).toBeDefined();
  });
});
