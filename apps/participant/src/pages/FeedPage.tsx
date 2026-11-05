import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  type FeedSort as ChosenSort,
  checkNewPost,
  FEED_SORTS,
  type FeedResponse,
  MAX_LINK_LENGTH,
  MAX_POLL_OPTION_LENGTH,
  MAX_POLL_OPTIONS,
  MAX_TITLE_LENGTH,
  MIN_POLL_OPTIONS,
  pollOptionsProblem,
  SORT_LABELS,
  type SpaceView,
  safeLink,
} from "@truman3/core";
import { CreatePostBar, FeedFrame, PhotoIcon, ProfileCard } from "@truman3/ui";
import { type FormEvent, type RefObject, useEffect, useRef, useState } from "react";
import { type FlowState, flowQuery, get, meQuery, post, postForm, type Written } from "../api.ts";
import { AreYouSure } from "../components/AreYouSure.tsx";
import { CommunitiesCard } from "../components/Community.tsx";
import { PostCard } from "../components/PostCard.tsx";
import { ExploreCards } from "./ExplorePage.tsx";

/** Picked once per page load, for studies that reshuffle the feed on each visit. */
const VISIT = Math.floor(Math.random() * 2 ** 31);

const COMPOSER = {
  photo: { placeholder: "Add a caption..." },
  text: { placeholder: "What's new?" },
  mixed: { placeholder: "What's new?" },
};

export type FeedSort = ChosenSort | null;

/** Lets someone choose the order, on a study that allows it. Each choice is recorded. */
export function SortPicker({
  surface,
  sort,
}: {
  surface: "home" | "space" | "following";
  /** The order the server is using, which is the last one recorded. */
  sort: FeedSort;
}) {
  const client = useQueryClient();
  const flow = useQuery(flowQuery);
  // The server takes the order from what's recorded, so this waits for that, and then for the feed.
  const change = useMutation({
    mutationFn: (next: FeedSort) => post("/feed/sort", { surface, sort: next }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["feed"] }),
  });
  if (!flow.data?.canSort) {
    return null;
  }
  return (
    <div className="px-3 text-sm sm:px-0">
      <label className="flex items-center justify-end gap-2">
        Sort
        <select
          value={(change.isPending ? change.variables : sort) ?? ""}
          disabled={change.isPending}
          onChange={(event) => change.mutate((event.target.value || null) as FeedSort)}
          className="rounded border border-stone-300 bg-white px-2 py-1"
        >
          <option value="">Default</option>
          {FEED_SORTS.map((order) => (
            <option key={order} value={order}>
              {SORT_LABELS[order]}
            </option>
          ))}
        </select>
      </label>
      {change.error && (
        <p role="alert" className="mt-1 text-right text-rose-700">
          That didn't work. Please try again.
        </p>
      )}
    </div>
  );
}

/** The window for writing a post, opened from the bar at the top of the feed. */
export function NewPostDialog({
  style,
  several,
  dialogRef,
  space,
}: {
  style: FlowState["platformStyle"];
  /** Whether this platform lets a post have several photos. */
  several: boolean;
  dialogRef: RefObject<HTMLDialogElement | null>;
  /** The key of the space this goes in, when writing from a space's page. */
  space?: string;
}) {
  const client = useQueryClient();
  const flow = useQuery(flowQuery);
  const titles = flow.data?.features.titles ?? false;
  const links = flow.data?.features.links ?? false;
  const spoilers = flow.data?.features.spoilers ?? false;
  const adultTags = flow.data?.features.adultTags ?? false;
  const polls = flow.data?.features.polls ?? false;
  const spacesOn = flow.data?.features.spaces ?? false;
  const chooseSpace = !space && spacesOn;
  const spaces = useQuery({
    queryKey: ["spaces"],
    queryFn: () => get<{ spaces: SpaceView[] }>("/spaces"),
    enabled: spacesOn,
  });
  const [flair, setFlair] = useState("");
  const [pollOpen, setPollOpen] = useState(false);
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");
  const [spoiler, setSpoiler] = useState(false);
  const [adult, setAdult] = useState(false);
  const [chosenSpace, setChosenSpace] = useState("");
  const [body, setBody] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const image = images[0];
  const { placeholder } = COMPOSER[style];
  const goodLink = link.trim() ? safeLink(link) : null;
  const badLink = link.trim().length > 0 && goodLink === null;
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!image) {
      setImageUrl(null);
      return;
    }
    const url = URL.createObjectURL(image);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const close = () => dialogRef.current?.close();
  const limit = flow.data?.maxPostLength ?? null;
  const tooLong = limit !== null && body.trim().length > limit;
  const where = space ?? chosenSpace;
  const whereSpace = spaces.data?.spaces.find(({ key }) => key === where);
  const flairChoices = whereSpace?.postFlair ?? [];
  const writtenOptions = pollOpen ? pollOptions.map((option) => option.trim()).filter(Boolean) : [];
  const pollProblem = pollOpen ? pollOptionsProblem(writtenOptions) : null;

  /** What a rule is asking, when one's asked if they're sure. */
  const [asked, setAsked] = useState<NonNullable<Written["confirm"]> | null>(null);
  const create = useMutation({
    mutationFn: (confirmedRule?: string) => {
      return postForm<Written>("/posts", {
        ...(confirmedRule ? { confirmedRule } : {}),
        ...(titles ? { title } : {}),
        ...(links && goodLink ? { link: goodLink } : {}),
        ...(spoilers && spoiler ? { spoiler: "true" } : {}),
        ...(adultTags && adult ? { adult: "true" } : {}),
        ...(flair ? { flair } : {}),
        ...(writtenOptions.length > 0 ? { pollOption: writtenOptions } : {}),
        body,
        image: images,
        ...(where ? { space: where } : {}),
      });
    },
    onSuccess: (written) => {
      if (written.confirm) {
        setAsked(written.confirm);
        return;
      }
      setAsked(null);
      setTitle("");
      setLink("");
      setSpoiler(false);
      setAdult(false);
      setChosenSpace("");
      setFlair("");
      setPollOpen(false);
      setPollOptions(["", ""]);
      setBody("");
      setImages([]);
      if (fileInput.current) {
        fileInput.current.value = "";
      }
      close();
    },
    onSettled: () => client.invalidateQueries(),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(undefined);
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="new-post-title"
      className="m-auto max-h-[90dvh] w-[min(92vw,28rem)] overflow-y-auto rounded-lg backdrop:bg-black/50"
    >
      <form onSubmit={submit} className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <h2 id="new-post-title" className="text-lg font-semibold">
            Add a New Post
          </h2>
          <button type="button" aria-label="Close" onClick={close} className="px-2 text-xl">
            ×
          </button>
        </div>
        {asked && (
          <AreYouSure
            asked={asked}
            sending={create.isPending}
            onPost={() => create.mutate(asked.rule)}
            onBack={() => setAsked(null)}
          />
        )}
        {chooseSpace && (
          <label className="flex flex-col gap-1 text-sm font-medium">
            Community
            <select
              value={chosenSpace}
              onChange={(event) => {
                setChosenSpace(event.target.value);
                setFlair("");
              }}
              className="rounded border border-stone-300 bg-white px-2 py-2 text-base font-normal"
            >
              <option value="">No community</option>
              {spaces.data?.spaces.map(({ key, name }) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        {flairChoices.length > 0 && (
          <label className="flex flex-col gap-1 text-sm font-medium">
            Flair
            <select
              required={whereSpace?.requirePostFlair ?? false}
              value={flair}
              onChange={(event) => setFlair(event.target.value)}
              className="rounded border border-stone-300 bg-white px-2 py-2 text-base font-normal"
            >
              <option value="">{whereSpace?.requirePostFlair ? "Choose one" : "None"}</option>
              {flairChoices.map(({ text }) => (
                <option key={text} value={text}>
                  {text}
                </option>
              ))}
            </select>
          </label>
        )}
        {titles && (
          <input
            aria-label="Title"
            required
            maxLength={MAX_TITLE_LENGTH}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Title"
            className="w-full rounded border border-stone-300 px-3 py-2 text-base font-semibold"
          />
        )}
        <textarea
          aria-label="Write a post"
          rows={3}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={placeholder}
          className="w-full rounded border border-stone-300 px-3 py-2 text-base"
        />
        {limit !== null && (
          <p
            data-testid="length-left"
            className={`text-xs ${tooLong ? "text-rose-700" : "text-stone-500"}`}
          >
            {limit - body.trim().length} characters left
          </p>
        )}
        {links && (
          <div className="flex flex-col gap-1 text-sm">
            <label className="flex flex-col gap-1 font-medium">
              Link
              <input
                type="url"
                maxLength={MAX_LINK_LENGTH}
                value={link}
                onChange={(event) => setLink(event.target.value)}
                placeholder="https://"
                className="w-full rounded border border-stone-300 px-3 py-2 text-base font-normal"
              />
            </label>
            {badLink && (
              <p className="text-rose-700">Use a full address, starting with http or https.</p>
            )}
          </div>
        )}
        {polls &&
          (pollOpen ? (
            <fieldset className="flex flex-col gap-2 text-sm">
              <legend className="font-medium">Poll options</legend>
              {pollOptions.map((option, index) => (
                // Options have nothing else to tell them apart while they're being written.
                // biome-ignore lint/suspicious/noArrayIndexKey: see above
                <div key={index} className="flex gap-2">
                  <input
                    aria-label={`Option ${index + 1}`}
                    maxLength={MAX_POLL_OPTION_LENGTH}
                    value={option}
                    onChange={(event) =>
                      setPollOptions(
                        pollOptions.map((other, at) => (at === index ? event.target.value : other)),
                      )
                    }
                    className="min-w-0 flex-1 rounded border border-stone-300 px-3 py-2 text-base"
                  />
                  {pollOptions.length > MIN_POLL_OPTIONS && (
                    <button
                      type="button"
                      aria-label={`Remove option ${index + 1}`}
                      onClick={() => setPollOptions(pollOptions.filter((_, at) => at !== index))}
                      className="px-2 text-xl"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              <div className="flex gap-3">
                {pollOptions.length < MAX_POLL_OPTIONS && (
                  <button
                    type="button"
                    className="underline"
                    onClick={() => setPollOptions([...pollOptions, ""])}
                  >
                    Add an option
                  </button>
                )}
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    setPollOpen(false);
                    setPollOptions(["", ""]);
                  }}
                >
                  Remove the poll
                </button>
              </div>
              {pollProblem && writtenOptions.length > 0 && (
                <p className="text-rose-700">{pollProblem}</p>
              )}
            </fieldset>
          ) : (
            <button
              type="button"
              className="self-start text-sm underline"
              onClick={() => setPollOpen(true)}
            >
              Add a poll
            </button>
          ))}
        {(spoilers || adultTags) && (
          <div className="flex flex-wrap gap-4 text-sm">
            {spoilers && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={spoiler}
                  onChange={(event) => setSpoiler(event.target.checked)}
                />
                Spoiler
              </label>
            )}
            {adultTags && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={adult}
                  onChange={(event) => setAdult(event.target.checked)}
                />
                Adult content
              </label>
            )}
          </div>
        )}
        {style !== "text" && (
          <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded border border-dashed border-stone-300 p-4 text-sm text-stone-500 focus-within:outline-2">
            {imageUrl ? (
              <img src={imageUrl} alt="Your chosen" className="max-h-64 rounded object-contain" />
            ) : (
              <PhotoIcon className="h-10 w-10" />
            )}
            {images.length > 1 && <span>{images.length} photos chosen</span>}
            {imageUrl
              ? `Choose ${several ? "different photos" : "a different photo"}`
              : `Add ${several ? "photos" : "a photo"}`}
            <input
              ref={fileInput}
              aria-label={several ? "Add photos" : "Add a photo"}
              type="file"
              accept="image/*"
              multiple={several}
              onChange={(event) => setImages([...(event.target.files ?? [])])}
              className="sr-only"
            />
          </label>
        )}
        {create.error && (
          <p role="alert" className="text-sm text-rose-700">
            {create.error.message}
          </p>
        )}
        <button
          type="submit"
          disabled={
            create.isPending ||
            tooLong ||
            badLink ||
            pollProblem !== null ||
            checkNewPost(style, body.trim().length > 0, images.length > 0, {
              titled: titles && title.trim().length > 0,
              linked: goodLink !== null,
              polled: pollOpen,
            }) !== null ||
            (titles && !title.trim())
          }
          className="rounded bg-stone-900 px-4 py-2 text-sm text-white disabled:opacity-40"
        >
          Post
        </button>
      </form>
    </dialog>
  );
}

export function FeedPage() {
  const flow = useQuery(flowQuery);
  const tabs = flow.data?.features.followingFeed ? flow.data.feedTabs : null;
  /** Which tab they chose. Until they choose, it's the one the study starts on. */
  const [chosenTab, setChosenTab] = useState<"home" | "following" | null>(null);
  const tab = chosenTab ?? (tabs?.startOnFollowing ? "following" : "home");
  const feed = useQuery({
    queryKey: ["feed", tab],
    enabled: flow.isSuccess,
    queryFn: () =>
      get<FeedResponse>(tab === "following" ? `/feed?surface=following` : `/feed?visit=${VISIT}`),
  });
  const me = useQuery(meQuery);
  const newPost = useRef<HTMLDialogElement>(null);

  return (
    <FeedFrame
      renderProfile={(compact) =>
        me.data && (
          <ProfileCard
            {...me.data}
            compact={compact}
            renderName={(className, name) => (
              <Link to="/u/$username" params={{ username: me.data.username }} className={className}>
                {name}
              </Link>
            )}
            footer={
              <Link
                to="/account"
                className="block border-t border-stone-200 py-2 text-center text-sm text-stone-700"
              >
                Edit profile
              </Link>
            }
          />
        )
      }
      side={
        <>
          {flow.data?.features.spaces && <CommunitiesCard />}
          {(flow.data?.features.trending || flow.data?.features.whoToFollow) && <ExploreCards />}
        </>
      }
    >
      {flow.data?.features.posting && me.data && (
        <>
          <CreatePostBar
            seed={me.data.username}
            pictureUrl={me.data.pictureUrl}
            showPhoto={flow.data.platformStyle !== "text"}
            onOpen={() => newPost.current?.showModal()}
          />
          <NewPostDialog
            style={flow.data.platformStyle}
            several={flow.data.features.galleries}
            dialogRef={newPost}
          />
        </>
      )}
      {tabs && (
        <div role="tablist" aria-label="Feeds" className="flex border-b border-stone-200 bg-white">
          {(["home", "following"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setChosenTab(key)}
              className={`flex-1 py-3 text-sm font-medium ${
                tab === key ? "border-b-2 border-stone-900" : "text-stone-500"
              }`}
            >
              {key === "home" ? tabs.home : tabs.following}
            </button>
          ))}
        </div>
      )}
      {feed.data && <SortPicker surface={tab} sort={feed.data.sort ?? null} />}
      {feed.data?.posts.length === 0 && (
        <p className="p-6 text-center text-stone-500">No posts to show.</p>
      )}
      {feed.data?.posts.map((post) => (
        <PostCard key={post.repostedBy?.id ?? post.id} post={post} />
      ))}
    </FeedFrame>
  );
}
