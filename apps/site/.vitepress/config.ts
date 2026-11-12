import { defineConfig } from "vitepress";

// The public site at truman-research.org (ADR 75): a home page for researchers deciding whether to
// use Truman, and, as they're written, the researcher docs.
export default defineConfig({
  title: "Truman",
  description:
    "A social media site built for research. Every post and every other user is made up by the researcher, and the only real thing is the participant.",
  lang: "en-US",
  cleanUrls: true,
  appearance: false,
  head: [
    ["link", { rel: "icon", href: "/truman.svg", type: "image/svg+xml" }],
    ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
    ["link", { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" }],
    [
      "link",
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Cabin:wght@400;600&family=Caveat:wght@600&family=Courier+Prime:wght@400;700&family=Source+Sans+3:wght@400;600&display=swap",
      },
    ],
  ],
});
