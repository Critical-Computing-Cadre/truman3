import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  checkNewPost,
  type LayoutKey,
  MAX_LINK_LENGTH,
  MAX_PLACE_LENGTH,
  MAX_POLL_OPTION_LENGTH,
  MAX_POLL_OPTIONS,
  MAX_TITLE_LENGTH,
  MIN_POLL_OPTIONS,
  pollOptionsProblem,
  type SpaceView,
  safeLink,
} from "@truman3/core";
import { Avatar, PhotoIcon, useIsPhone, usePlatform } from "@truman3/ui";
import { type FormEvent, type RefObject, useRef, useState } from "react";
import { type FlowState, flowQuery, get, meQuery, postForm, type Written } from "../api.ts";
import { AreYouSure } from "./AreYouSure.tsx";
import { ChosenPicture } from "./ChosenPicture.tsx";

const COMPOSER = {
  photo: { placeholder: "Add a caption..." },
  text: { placeholder: "What's new?" },
  mixed: { placeholder: "What's new?" },
};

/**
 * How writing a post looks on a phone, for each kind of site: what's written across the top,
 * whether leaving is a cross or the word Cancel, where their own picture goes, what the empty box
 * asks, and whether choosing a photo comes before the words. The button that sends it is "Post" on
 * all of them, so it reads the same aloud everywhere.
 */
const PHONE_LOOK: Record<
  LayoutKey,
  {
    title: string;
    cancel: boolean;
    who: "row" | "beside" | "none";
    ask: string;
    photoFirst: boolean;
  }
> = {
  classic: {
    title: "Create post",
    cancel: false,
    who: "row",
    ask: "What's on your mind?",
    photoFirst: false,
  },
  forum: { title: "", cancel: false, who: "none", ask: "body text", photoFirst: false },
  "short-posts": { title: "", cancel: true, who: "beside", ask: "What's up?", photoFirst: false },
  photo: {
    title: "New post",
    cancel: false,
    who: "none",
    ask: "Add a caption...",
    photoFirst: true,
  },
  "short-video": {
    title: "New post",
    cancel: false,
    who: "none",
    ask: "Add a caption...",
    photoFirst: true,
  },
  video: { title: "Create post", cancel: false, who: "row", ask: "What's new?", photoFirst: false },
};

/** On a phone the boxes to write in have no outline, as in these apps. Wider, they keep it. */
const PLAIN = "max-sm:rounded-none max-sm:border-0 max-sm:px-0 max-sm:outline-none";

/**
 * The window for writing a post, opened from the bar at the top of the feed, or on a phone from a
 * button in the page's own bars (Shell).
 */
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
  const me = useQuery(meQuery);
  const phone = useIsPhone();
  const { layout } = usePlatform();
  const titles = flow.data?.features.titles ?? false;
  const links = flow.data?.features.links ?? false;
  const spoilers = flow.data?.features.spoilers ?? false;
  const adultTags = flow.data?.features.adultTags ?? false;
  const polls = flow.data?.features.polls ?? false;
  const places = flow.data?.features.places ?? false;
  const tagging = flow.data?.features.photoTags ?? false;
  const people = useQuery({
    queryKey: ["people"],
    queryFn: () => get<{ people: { username: string; name: string }[] }>("/people"),
    enabled: tagging,
  });
  const [tagged, setTagged] = useState<string[]>([]);
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
  const [place, setPlace] = useState("");
  const [spoiler, setSpoiler] = useState(false);
  const [adult, setAdult] = useState(false);
  const [chosenSpace, setChosenSpace] = useState("");
  const [body, setBody] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const image = images[0];
  const { placeholder } = COMPOSER[style];
  const goodLink = link.trim() ? safeLink(link) : null;
  const badLink = link.trim().length > 0 && goodLink === null;
  const fileInput = useRef<HTMLInputElement>(null);

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
        ...(places && place.trim() ? { place: place.trim() } : {}),
        ...(tagging && tagged.length > 0 ? { tagged } : {}),
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
      setPlace("");
      setTagged([]);
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

  const cantPost =
    create.isPending ||
    tooLong ||
    badLink ||
    pollProblem !== null ||
    checkNewPost(style, body.trim().length > 0, images.length > 0, {
      titled: titles && title.trim().length > 0,
      linked: goodLink !== null,
      polled: pollOpen,
    }) !== null ||
    (titles && !title.trim());

  // On a phone it's a whole screen, worded the way this kind of site words it, with Post in the top
  // corner where the keyboard can't cover it. On a wider screen it's a window in the middle.
  const look = PHONE_LOOK[layout];
  const photoFirst = phone && look.photoFirst && style !== "text";
  const inToolbar = phone && !photoFirst;
  const clearPhotos = () => {
    setImages([]);
    if (fileInput.current) {
      fileInput.current.value = "";
    }
  };
  const pickerWords = image
    ? `Choose ${several ? "different photos" : "a different photo"}`
    : `Add ${several ? "photos" : "a photo"}`;
  const picker = style !== "text" && (
    <label
      className={
        inToolbar
          ? "flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-accent focus-within:outline-2"
          : `flex cursor-pointer flex-col items-center justify-center gap-1 rounded border border-dashed border-stone-300 p-4 text-sm text-stone-500 focus-within:outline-2 ${
              photoFirst ? "aspect-square w-full" : ""
            }`
      }
    >
      {inToolbar ? (
        <PhotoIcon className="h-6 w-6" />
      ) : image ? (
        <ChosenPicture
          file={image}
          label="Your chosen"
          className={`max-w-full rounded object-contain ${photoFirst ? "max-h-[85%]" : "max-h-64"}`}
        />
      ) : (
        <PhotoIcon className="h-10 w-10" />
      )}
      {!inToolbar && images.length > 1 && <span>{images.length} photos chosen</span>}
      <span className={inToolbar ? "sr-only" : ""}>{pickerWords}</span>
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
  );
  const lengthLeft = limit !== null && (
    <p
      data-testid="length-left"
      className={`text-xs ${tooLong ? "text-rose-700" : "text-stone-500"} ${phone ? "ml-auto pr-2" : ""}`}
    >
      {limit - body.trim().length} characters left
    </p>
  );

  return (
    <dialog
      ref={dialogRef}
      aria-label="Add a New Post"
      className="m-auto max-h-[90dvh] w-[min(92vw,28rem)] overflow-y-auto rounded-lg bg-white text-stone-900 backdrop:bg-black/50 max-sm:m-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-screen max-sm:max-w-none max-sm:rounded-none"
    >
      <form
        onSubmit={submit}
        className="flex flex-col gap-3 p-4 max-sm:min-h-full max-sm:gap-0 max-sm:p-0"
      >
        <div className="flex items-center gap-2 max-sm:sticky max-sm:top-0 max-sm:z-10 max-sm:h-13 max-sm:shrink-0 max-sm:border-b max-sm:border-stone-200 max-sm:bg-white max-sm:px-2">
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="order-last px-2 text-xl max-sm:order-none max-sm:flex max-sm:h-10 max-sm:min-w-10 max-sm:items-center max-sm:justify-center max-sm:text-2xl"
          >
            {phone && look.cancel ? <span className="text-base text-accent">Cancel</span> : "×"}
          </button>
          <h2 className="flex-1 text-lg font-semibold max-sm:text-base">
            {phone ? look.title : "Add a New Post"}
          </h2>
          {phone && (
            <button
              type="submit"
              disabled={cantPost}
              className="mr-1 rounded-full bg-accent-fill px-4 py-1.5 text-sm font-bold text-on-accent disabled:opacity-40"
            >
              Post
            </button>
          )}
        </div>
        <div className="flex flex-col gap-3 max-sm:flex-1 max-sm:px-4 max-sm:py-3">
          {asked && (
            <AreYouSure
              asked={asked}
              sending={create.isPending}
              onPost={() => create.mutate(asked.rule)}
              onBack={() => setAsked(null)}
            />
          )}
          {phone && look.who === "row" && me.data && (
            <div className="flex items-center gap-2">
              <Avatar seed={me.data.username} url={me.data.pictureUrl} />
              <span className="font-semibold">{me.data.name}</span>
            </div>
          )}
          {photoFirst && picker}
          {chooseSpace && (
            <label className="flex flex-col gap-1 text-sm font-medium max-sm:flex-row max-sm:items-center max-sm:gap-2">
              Community
              <select
                value={chosenSpace}
                onChange={(event) => {
                  setChosenSpace(event.target.value);
                  setFlair("");
                }}
                className="rounded border border-stone-300 bg-white px-2 py-2 text-base font-normal max-sm:min-w-0 max-sm:flex-1 max-sm:rounded-full max-sm:px-3 max-sm:py-1.5 max-sm:text-sm"
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
            <label className="flex flex-col gap-1 text-sm font-medium max-sm:flex-row max-sm:items-center max-sm:gap-2">
              Flair
              <select
                required={whereSpace?.requirePostFlair ?? false}
                value={flair}
                onChange={(event) => setFlair(event.target.value)}
                className="rounded border border-stone-300 bg-white px-2 py-2 text-base font-normal max-sm:min-w-0 max-sm:flex-1 max-sm:rounded-full max-sm:px-3 max-sm:py-1.5 max-sm:text-sm"
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
              className={`w-full rounded border border-stone-300 px-3 py-2 text-base font-semibold ${PLAIN}  max-sm:text-2xl max-sm:font-bold`}
            />
          )}
          <div className="flex gap-3">
            {phone && look.who === "beside" && me.data && (
              <Avatar seed={me.data.username} url={me.data.pictureUrl} />
            )}
            <textarea
              aria-label="Write a post"
              rows={3}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={phone && style !== "photo" ? look.ask : placeholder}
              className={`w-full min-w-0 flex-1 rounded border border-stone-300 px-3 py-2 text-base ${PLAIN} max-sm:min-h-32 max-sm:resize-none max-sm:text-lg`}
            />
          </div>
          {inToolbar && image && (
            <div className="relative self-start">
              <ChosenPicture
                file={image}
                label="Your chosen"
                className="max-h-72 max-w-full rounded-xl object-contain"
              />
              <button
                type="button"
                aria-label={images.length > 1 ? "Remove the photos" : "Remove the photo"}
                onClick={clearPhotos}
                className="absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-[#000]/70 text-xl text-[#fff]"
              >
                ×
              </button>
              {images.length > 1 && (
                <p className="mt-1 text-sm text-stone-500">{images.length} photos chosen</p>
              )}
            </div>
          )}
          {!phone && lengthLeft}
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
          {places && (
            <label className="flex flex-col gap-1 text-sm font-medium">
              Add a place (optional)
              <input
                maxLength={MAX_PLACE_LENGTH}
                value={place}
                onChange={(event) => setPlace(event.target.value)}
                placeholder="Where was this?"
                className="w-full rounded border border-stone-300 px-3 py-2 text-base font-normal"
              />
            </label>
          )}
          {tagging && (people.data?.people.length ?? 0) > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">
                Tag people{tagged.length > 0 ? ` (${tagged.length})` : ""}
              </summary>
              <fieldset className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto">
                <legend className="sr-only">Tag people</legend>
                {people.data?.people.map(({ username, name }) => (
                  <label key={username} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={tagged.includes(username)}
                      onChange={(event) =>
                        setTagged(
                          event.target.checked
                            ? [...tagged, username]
                            : tagged.filter((other) => other !== username),
                        )
                      }
                    />
                    {name} <span className="text-stone-500">@{username}</span>
                  </label>
                ))}
              </fieldset>
            </details>
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
                          pollOptions.map((other, at) =>
                            at === index ? event.target.value : other,
                          ),
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
          {!phone && picker}
          {create.error && (
            <p role="alert" className="text-sm text-rose-700">
              {create.error.message}
            </p>
          )}
        </div>
        {phone && (inToolbar || limit !== null) && (
          <div className="sticky bottom-0 flex h-12 shrink-0 items-center gap-1 border-t border-stone-200 bg-white px-2">
            {inToolbar && picker}
            {lengthLeft}
          </div>
        )}
        {!phone && (
          <button
            type="submit"
            disabled={cantPost}
            className="rounded bg-accent-fill px-4 py-2 text-sm text-on-accent disabled:opacity-40"
          >
            Post
          </button>
        )}
      </form>
    </dialog>
  );
}
