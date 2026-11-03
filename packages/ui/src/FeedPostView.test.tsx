import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type FeatureKey, type FeedPost, TEMPLATES } from "@truman3/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeedPostView } from "./FeedPostView.tsx";
import { PlatformProvider } from "./platform.tsx";

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
