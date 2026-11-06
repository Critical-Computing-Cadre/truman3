import {
  FEATURE_KEYS,
  FEATURES,
  type FeedPost,
  TEMPLATE_KEYS,
  TEMPLATES,
  type TemplateKey,
} from "@truman3/core";
import { FeedPostView, PlatformProvider } from "@truman3/ui";
import { useState } from "react";

/** A made-up photo, drawn here, so a preview needs nothing from a server. */
const SAMPLE_PHOTO = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f59e0b"/><stop offset="1" stop-color="#db2777"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/><circle cx="290" cy="120" r="50" fill="#fde68a"/><path d="M0 320 L140 200 L260 300 L330 250 L400 300 L400 400 L0 400z" fill="#7c2d12" opacity=".6"/></svg>',
)}`;

const author = { username: "ann", name: "Ann Lee", pictureUrl: null, isViewer: false };

/** One made-up post, the same for every template, so the difference is the platform. */
const SAMPLE: FeedPost = {
  id: "sample",
  author,
  title: "Our first trip up the lake trail",
  body: "Made it to the top before sunrise. Worth every step.",
  attachments: [{ type: "image", url: SAMPLE_PHOTO }],
  at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  likes: 108,
  liked: false,
  likedBy: "Bob",
  ups: 42,
  downs: 3,
  vote: null,
  flagged: false,
  repostCount: 12,
  quoteCount: 2,
  viewCount: 5400,
  commentCount: 1,
  comments: [
    {
      id: "sample-comment",
      depth: 0,
      author: { username: "bob", name: "Bob", pictureUrl: null, isViewer: false },
      body: "Beautiful! Which trail?",
      at: new Date(Date.now() - 3_600_000).toISOString(),
      likes: 2,
      liked: false,
      ups: 2,
      downs: 0,
      vote: null,
      flagged: false,
    },
  ],
};

/** A second post, with words only, so a preview shows more than one. */
const SECOND: FeedPost = {
  ...SAMPLE,
  id: "sample-2",
  author: { username: "bob", name: "Bob", pictureUrl: null, isViewer: false },
  title: "Trails for beginners?",
  body: "Anyone know a good trail for someone just starting out?",
  attachments: [],
  likedBy: undefined,
  likes: 14,
  ups: 9,
  commentCount: 0,
  comments: [],
};

/** What a template's posts look like, from the components participants see. */
function TemplatePreview({ template }: { template: TemplateKey }) {
  const { layout, features } = TEMPLATES[template];
  // Short posts are words, so its sample leaves the photo out.
  const first = template === "shortPosts" ? { ...SAMPLE, attachments: [] } : SAMPLE;
  // The server leaves out what a feature that's off would add, so the sample does too.
  const posts = [first, SECOND].map(({ viewCount, ...post }) => ({
    ...post,
    ...(features.viewCounts && viewCount !== undefined ? { viewCount } : {}),
    comments: features.postPages ? [] : post.comments,
  }));
  return (
    <div
      aria-hidden="true"
      inert
      className="pointer-events-none h-56 overflow-hidden rounded-md bg-stone-100"
    >
      {/* Photos are kept short here, so a preview shows what's around them. */}
      <div className="w-[200%] origin-top-left scale-50 space-y-3 p-4 [&_img]:max-h-56 [&_img]:object-cover">
        <PlatformProvider platform={{ layout, features }}>
          {posts.map((post) => (
            <FeedPostView key={post.id} post={post} />
          ))}
        </PlatformProvider>
      </div>
    </div>
  );
}

/** What people can do on a template, by the names researchers see in Settings. */
function featureNames(template: TemplateKey) {
  const { features } = TEMPLATES[template];
  return FEATURE_KEYS.filter((key) => features[key]).map((key) => FEATURES[key].name);
}

/**
 * Questions about how a platform works, never about what a study is for. Each "yes" suggests a
 * template, and the first one answered yes wins.
 */
const QUESTIONS: { question: string; suggests: TemplateKey }[] = [
  { question: "Do people belong to communities, each with its own page?", suggests: "forum" },
  { question: "Is every post a photo?", suggests: "photo" },
  { question: "Are posts short, and passed along with reposts?", suggests: "shortPosts" },
];

function HelpMeDecide({ onChoose }: { onChoose: (template: TemplateKey) => void }) {
  const [answers, setAnswers] = useState<Record<number, boolean>>({});
  const answered = Object.keys(answers).length === QUESTIONS.length;
  const suggested =
    QUESTIONS.find((_, index) => answers[index] === true)?.suggests ??
    (answered ? "classic" : null);
  return (
    <details className="rounded-lg border border-stone-200 bg-white p-3 text-sm">
      <summary className="cursor-pointer font-medium">Help me decide</summary>
      <p className="mt-2 text-stone-600">
        A few questions about how the platform works. It only picks a card, and you can change it.
      </p>
      <ol className="mt-2 space-y-2">
        {QUESTIONS.map(({ question }, index) => (
          <li key={question}>
            <fieldset className="flex flex-wrap items-center gap-3">
              <legend className="float-left mr-2">{question}</legend>
              {(
                [
                  [true, "Yes"],
                  [false, "No"],
                ] as const
              ).map(([value, label]) => (
                <label key={label} className="flex items-center gap-1">
                  <input
                    type="radio"
                    name={`decide-${index}`}
                    checked={answers[index] === value}
                    onChange={() => setAnswers({ ...answers, [index]: value })}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          </li>
        ))}
      </ol>
      {suggested && (
        <p className="mt-3 flex flex-wrap items-center gap-2">
          <span>
            <strong>{TEMPLATES[suggested].name}</strong> sounds closest.
          </span>
          <button
            type="button"
            onClick={() => onChoose(suggested)}
            className="rounded border border-stone-300 px-2 py-1"
          >
            Use {TEMPLATES[suggested].name}
          </button>
        </p>
      )}
    </details>
  );
}

/** The kinds of platform, each with a live look at its posts, and more about it when wanted. */
export function TemplateCards({
  chosen,
  onChoose,
}: {
  chosen: TemplateKey;
  onChoose: (template: TemplateKey) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {TEMPLATE_KEYS.map((key) => (
          <div
            key={key}
            className={`rounded-lg border bg-white p-3 ${chosen === key ? "border-stone-900 ring-1 ring-stone-900" : "border-stone-200"}`}
          >
            <label className="block cursor-pointer space-y-2">
              <span className="flex items-baseline gap-2">
                <input
                  type="radio"
                  name="template"
                  aria-label={TEMPLATES[key].name}
                  aria-describedby={`template-${key}`}
                  checked={chosen === key}
                  onChange={() => onChoose(key)}
                />
                <span className="font-medium">{TEMPLATES[key].name}</span>
              </span>
              <TemplatePreview template={key} />
              <span id={`template-${key}`} className="block text-sm text-stone-600">
                {TEMPLATES[key].description}
              </span>
            </label>
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-stone-700">
                Read more<span className="sr-only"> about {TEMPLATES[key].name}</span>
              </summary>
              <p className="mt-2">{TEMPLATES[key].about}</p>
              <p className="mt-2 text-stone-600">
                <span className="font-medium text-stone-800">What people can do: </span>
                {featureNames(key).join(", ")}. Any of it can be turned off in Settings.
              </p>
            </details>
          </div>
        ))}
      </div>
      <HelpMeDecide onChoose={onChoose} />
    </div>
  );
}
