<script setup lang="ts">
// The home page (ADR 75). A scene from EatSnap.Love, the first Truman study, plays in the page: the
// visitor is put in a version at random, can like, flag, or reply, and is shown their own record.
// Nothing leaves the browser.
import { onMounted, onUnmounted } from "vue";

let timer: ReturnType<typeof setInterval> | undefined;
let onScroll: (() => void) | undefined;

onMounted(() => {
  // A demo wants a recruitment ID, as a recruitment site would give. Each visitor gets one made up
  // here, so nobody types anything. See TryIt.vue, which does the same on a study's own page.
  const visitor = `demo-${Math.random().toString(36).slice(2, 10)}`;
  for (const link of document.querySelectorAll<HTMLAnchorElement>("a[data-try]")) {
    link.href = `https://clikbrite.com/join/try-${link.dataset.try}?PROLIFIC_PID=${visitor}`;
  }
  // A scene from EatSnap.Love, the first Truman study, played in the page. Nothing leaves the browser.
  const cast = {
    kitty: { name: "KittyCatBakes", img: "/home/kitty.jpg" },
    marcel: { name: "Marcel Bauld", img: "/home/marcel.jpg" },
    jake: { name: "Jake T.", img: "/home/jake.jpg" },
    cel: { name: "Celia McCarron", img: "/home/celia.jpg" },
    you: { name: "You" },
  };
  const $ = (id) => document.getElementById(id);
  const comments = $("comments"),
    stage = $("stage"),
    condition = $("condition");
  const started = Date.now();
  const you = {
    condition: Math.random() < 0.5 ? "alone" : "defended",
    replies: [],
    flagged: false,
    liked: false,
    revealed: false,
    firstAct: null,
    deepest: 0,
  };
  const acted = () => {
    if (you.firstAct === null) you.firstAct = Math.round((Date.now() - started) / 1000);
  };

  function say(who, text, { only, flaggable, fresh = true } = {}) {
    const person = cast[who];
    const row = document.createElement("div");
    row.className = `comment${who === "you" ? "" : " cast"}${fresh ? " new" : ""}`;
    if (only) row.dataset.only = only;
    const face =
      who === "you"
        ? '<div class="face small"><div class="you">You</div></div>'
        : `<div class="face small"><img src="${person.img}" alt=""><svg><use href="#bot"/></svg></div>`;
    const tag =
      who === "you"
        ? '<span class="tag real">real</span>'
        : only
          ? '<span class="tag">version B only</span>'
          : "";
    row.innerHTML = `${face}<div class="bubble"><span class="name"></span> ${tag}<div class="text"></div>${flaggable ? '<div class="row"><button type="button">Flag</button></div>' : ""}</div>`;
    row.querySelector(".name").textContent = person.name;
    row.querySelector(".text").textContent = text;
    if (flaggable) {
      row.querySelector("button").addEventListener("click", (event) => {
        if (you.flagged) return;
        you.flagged = true;
        acted();
        event.target.replaceWith(
          Object.assign(document.createElement("span"), {
            className: "flagged",
            textContent: "Flagged. Thanks for telling us.",
          }),
        );
        debrief();
      });
    }
    comments.append(row);
    $("count").textContent = comments.children.length;
  }

  function debrief() {
    const rows = [
      [
        "version",
        you.condition === "defended"
          ? "B, someone sticks up for Jake"
          : "A, nobody sticks up for Jake",
      ],
      ["on page", `${Math.round((Date.now() - started) / 1000)} s`],
      ["read", `${you.deepest}% of the page`],
      ["first move", you.firstAct === null ? "nothing yet" : `after ${you.firstAct} s`],
      ["liked the pizza", you.liked ? "yes" : "no"],
      ["flagged Kitty", you.flagged ? "yes" : "no"],
      ["said", you.replies.length ? you.replies.map((text) => `"${text}"`).join(" ") : "nothing"],
      ["peeked behind it", you.revealed ? "yes" : "no"],
    ];
    $("sheet").replaceChildren(
      ...rows.flatMap(([term, value]) => [
        Object.assign(document.createElement("dt"), { textContent: term }),
        Object.assign(document.createElement("dd"), { textContent: value }),
      ]),
    );
  }

  say("kitty", "That looks disgusting tbh :/", { flaggable: true, fresh: false });
  say("marcel", "what type of pizza?", { fresh: false });
  say("jake", "just like a fancy cheese pizza", { fresh: false });
  function setDefender() {
    const there = comments.querySelector('[data-only="defended"]');
    if (you.condition === "defended" && !there) {
      say("cel", "rude. it looks great, Jake", { only: "defended", fresh: false });
    } else if (you.condition === "alone" && there) {
      there.remove();
      $("count").textContent = comments.children.length;
    }
    debrief();
  }
  condition.value = you.condition;
  setDefender();
  condition.addEventListener("change", () => {
    you.condition = condition.value;
    setDefender();
  });

  $("reveal").addEventListener("click", () => {
    const on = stage.classList.toggle("revealed");
    you.revealed = you.revealed || on;
    $("reveal").setAttribute("aria-pressed", String(on));
    $("reveal").textContent = on ? "Put the faces back" : "See who's real";
    $("hint").textContent = on ? "Everyone but you. Try the other version." : "Go on, press it.";
    debrief();
  });
  $("like").addEventListener("click", () => {
    you.liked = !you.liked;
    acted();
    $("like").setAttribute("aria-pressed", String(you.liked));
    $("like").textContent = you.liked ? "♥ Liked" : "♡ Like";
    $("likes").textContent = 4 + (you.liked ? 1 : 0);
    debrief();
  });
  $("compose").addEventListener("submit", (event) => {
    event.preventDefault();
    const text = $("reply").value.trim();
    if (!text) return;
    $("reply").value = "";
    acted();
    say("you", text);
    you.replies.push(text);
    debrief();
    if (you.replies.length > 1) return;
    // The plot answers the participant.
    setTimeout(() => say("kitty", "it's just my opinion lol"), 1800);
    setTimeout(() => say("jake", "thanks. i thought it was pretty good"), 4200);
  });
  onScroll = () => {
    const reach = Math.round(
      ((scrollY + innerHeight) / document.documentElement.scrollHeight) * 100,
    );
    if (reach > you.deepest) {
      you.deepest = Math.min(100, reach);
      debrief();
    }
  };
  addEventListener("scroll", onScroll, { passive: true });
  timer = setInterval(debrief, 1000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
  if (onScroll) removeEventListener("scroll", onScroll);
});
</script>

<template>
  <div class="truman-home">
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <symbol id="bot" viewBox="0 0 40 40">
    <circle cx="20" cy="20" r="20" fill="#e9f8f3"/>
    <rect x="3" y="15" width="4" height="10" rx="2" fill="#5cc4a8"/><rect x="33" y="15" width="4" height="10" rx="2" fill="#5cc4a8"/>
    <rect x="19" y="3" width="2" height="6" fill="#5cc4a8"/><circle cx="20" cy="3.5" r="2" fill="#5cc4a8"/>
    <rect x="7" y="8" width="26" height="25" rx="8" fill="#5cc4a8"/>
    <circle cx="14.5" cy="19" r="5" fill="#fff"/><circle cx="25.5" cy="19" r="5" fill="#fff"/>
    <circle cx="14.5" cy="19" r="2.2" fill="#22463d"/><circle cx="25.5" cy="19" r="2.2" fill="#22463d"/>
    <rect x="14" y="27" width="12" height="2.5" rx="1.2" fill="#22463d"/>
  </symbol>
</svg>

<div class="room" id="stage">
  <div class="wrap">
    <nav aria-label="Site">
      <a class="brand" href="#top">
        <svg viewBox="0 0 93 93" aria-hidden="true">
          <defs><clipPath id="r"><rect width="93" height="93" rx="11"/></clipPath></defs>
          <g clip-path="url(#r)">
            <rect width="93" height="93" fill="#9dd9ff"/>
            <path d="M13.5 71.5h16.8V54.4h16.8V37.3h16.5V20.5h17L110 50v60H52z" fill="#6eacd9" fill-opacity="0.7"/>
            <path d="M13.5 71.5h16.8V54.4h16.8V37.3h16.5V20.5h17" fill="none" stroke="#fff" stroke-width="5.4" stroke-linecap="square"/>
          </g>
        </svg>
        truman
        <span class="beta">beta</span>
      </a>
      <div class="links">
        <a href="#trick">How it works</a>
        <a href="/studies/">Studies</a>
        <a href="/guide/">Guide</a>
        <a href="/developers/">Developers</a>
        <a href="/irb">For IRBs</a>
        <a href="/about">About</a>
      </div>
      <a class="button small" href="https://app.truman-research.org/admin/">Sign in</a>
    </nav>

    <div class="hero" id="top">
      <div class="pitch">
        <h1>We built a fake social network to study <em>real people.</em></h1>
        <p>On Truman, the posts are written ahead of time and the other users are all made up. The likes are fake too. <b>The only real thing is the person scrolling</b>, and they don't know.</p>
        <p class="hand">Right now that's you. Kitty just trashed Jake's pizza. Do something?</p>
        <div class="actions">
          <a class="button" href="https://app.truman-research.org/admin/">Run a study on it</a>
          <a class="button quiet" href="#study">Try a study</a>
          <a class="button quiet" href="#trick">How it works</a>
        </div>
      </div>

      <div>
        <div class="controls">
          <button class="switch" id="reveal" type="button" aria-pressed="false">See who's real</button>
          <label class="condition" for="condition">Version
            <select id="condition">
              <option value="alone">A: nobody sticks up for Jake</option>
              <option value="defended">B: someone sticks up for Jake</option>
            </select>
          </label>
          <span class="hint" id="hint">Go on, press it.</span>
        </div>
        <div class="dome">
          <div class="app" aria-label="A post on EatSnap.Love, the site from the first Truman study">
            <div class="appbar">EatSnap.Love <span>Home</span></div>
            <div class="post cast">
              <div class="who">
                <div class="face"><img src="/home/jake.jpg" alt=""><svg><use href="#bot"/></svg></div>
                <div><span class="name">Jake T.</span> <span class="time">· 1d</span></div>
              </div>
              <div>i had this pizza yesterday</div>
              <img class="photo" src="/home/pizza.jpg" alt="A cheese pizza with basil on a restaurant table, one slice pulled away">
              <div class="counts"><span id="likes">4</span> likes · <span id="count">3</span> comments <span class="tag">scripted</span></div>
              <div class="acts"><button type="button" id="like" aria-pressed="false">♡ Like</button></div>
            </div>
            <div class="comments" id="comments"></div>
            <form class="compose" id="compose">
              <input id="reply" type="text" placeholder="Write a comment…" aria-label="Write a comment" maxlength="140" autocomplete="off">
              <button type="submit">Post</button>
            </form>
          </div>
        </div>
        <div class="base"></div>
      </div>
    </div>
  </div>
</div>

<section id="trick">
  <div class="wrap">
    <div class="head">
      <p class="scene">How it works</p>
      <h2>You make the whole world. Then you let one person in.</h2>
      <p>No code. You build it in the browser, or fill in a spreadsheet.</p>
    </div>
    <div class="parts">
      <div class="part"><h3>The site</h3><p>It can look like a photo app, a short-posts app, a forum, or a plain feed. Give it a name, a logo, and a web address that doesn't say "research" anywhere.</p></div>
      <div class="part"><h3>The people</h3><p>EatSnap has 76 of them. Each has a name, a face, a bio, and posts going back days. They're yours to write. They can also reply on their own, using an AI model that stays inside rules you set.</p></div>
      <div class="part"><h3>The plot</h3><p>Things happen on a clock, or because of what the participant just did.</p><q>Day 2, minute 37: Kitty insults the pizza.</q><q>If the participant flags it: thank them.</q></div>
      <div class="part"><h3>The versions</h3><p>This is the experiment. Half your participants see someone stick up for Jake. Half don't. Nothing else changes, so whatever they do differently is because of that.</p></div>
      <div class="part"><h3>The dry run</h3><p>Before anyone real shows up, walk through it yourself at any minute of any day. Or send in a few hundred pretend participants and see what breaks.</p></div>
      <div class="part"><h3>The tape</h3><p>You get everything: what each person saw, in what order, for how long, and what they did about it. It comes as spreadsheets, with a guide to every column.</p></div>
    </div>
  </div>
</section>

<section class="wallband" id="looks">
  <div class="wrap">
    <div class="head">
      <p class="scene">What it can look like</p>
      <h2>Four kinds of site, and they don't look like each other.</h2>
      <p>These are the four starting points, each with its sample content, as a participant sees them. Change the name, the logo, the color, and what people can do, and it's your site.</p>
    </div>
    <div class="looks">
      <a href="/guide/kinds-of-site#classic"><img src="/shots/kind-classic-wide.png" alt="A community feed in blue, with stories, a menu down the left, and people to follow" loading="lazy" width="1280" height="800"><b>Classic</b><span>A community feed, with comments open under every post.</span></a>
      <a href="/guide/kinds-of-site#photo"><img src="/shots/kind-photo-wide.png" alt="A dark photo app, with stories across the top and a rail of icons" loading="lazy" width="1280" height="800"><b>Photo</b><span>Square photos, stories, and a profile that's a grid.</span></a>
      <a href="/guide/kinds-of-site#short-posts"><img src="/shots/kind-short-posts-wide.png" alt="A navy microblog, with short posts, a context note, and what's happening" loading="lazy" width="1280" height="800"><b>Short posts</b><span>A microblog, with reposts, quotes, labels, and context notes.</span></a>
      <a href="/guide/kinds-of-site#forum"><img src="/shots/kind-forum-wide.png" alt="A forum in orange, with communities, votes, and flair" loading="lazy" width="1280" height="800"><b>Forum</b><span>Communities with votes, threads, rules, and moderators.</span></a>
    </div>
  </div>
</section>

<section id="ai">
  <div class="wrap">
    <div class="head">
      <p class="scene">AI, where you want it</p>
      <h2>The cast can improvise. You still write the script.</h2>
      <p>A study runs fine with no AI at all. When you want it, a model can take on a few jobs, each inside limits you set. <a href="/guide/ai">How AI fits in →</a></p>
    </div>
    <div class="parts">
      <div class="part"><h3>A cast that answers back</h3><p>A scripted reply can't know what the participant just said. A model can write the line in the character's voice, and a second check reads it before it's posted. You decide who speaks and when.</p></div>
      <div class="part"><h3>Or you approve every line</h3><p>For a Wizard of Oz study, each line waits for a researcher to approve it, change it, or skip it.</p></div>
      <div class="part"><h3>Pretend participants</h3><p>Describe a few people in a sentence each and have a model play them through your study. Then read what each one saw, did, and why.</p></div>
      <div class="part"><h3>A first draft from a brief</h3><p>Describe the study you have in mind, and an agent drafts the cast, the posts, the plot, and the tests for you to review.</p></div>
      <div class="part"><h3>Bring your own agent</h3><p>Already use Claude Code or another agent? Connect it to Truman and it can build and test studies with you. It can't launch one or touch participants' data. <a href="/developers/api-and-agents">How to connect one →</a></p></div>
      <div class="part"><h3>It's all on the tape</h3><p>Your data says which lines a model wrote, what it was asked, what the check said, and what it cost.</p></div>
    </div>
  </div>
</section>

<section class="wallband" id="phone">
  <div class="wrap">
    <div class="head">
      <p class="scene">On a phone</p>
      <h2>People live on their phones. A study can too.</h2>
      <p>Every kind of site works in a phone's browser today. A phone app for participants is on the way: the same study, on their home screen, with notifications that bring them back on day two the way a real platform would. It isn't in the app stores yet. <a href="/guide/mobile-app">About the phone app →</a></p>
    </div>
  </div>
</section>

<section class="room" id="debrief">
  <div class="wrap watch">
    <div class="head">
      <p class="scene">By the way</p>
      <h2>You've been in a study since you got here.</h2>
      <p>When this page loaded, it flipped a coin and put you in version A or B. It has been taking notes since. This is roughly what a researcher gets back for every participant.</p>
      <p class="after">Relax: it's all in your browser, we never see it, and it's gone when you close the tab. We didn't ask first because nothing was kept. A real study has to ask first, and has to tell people the truth at the end.</p>
    </div>
    <div class="monitor">
      <div class="screen" aria-live="off">
        <div class="rec"><span>● REC</span><span>SUBJECT 001</span></div>
        <dl id="sheet"></dl>
      </div>
    </div>
  </div>
</section>

<section class="wallband" id="study">
  <div class="wrap">
    <div class="head">
      <p class="scene">Studies</p>
      <h2>Take one of ours and change it.</h2>
      <p>These are finished studies, with every post, person, and rule written out. Four of them are running: press <b>Try it</b> and you're the participant. Read how one works, then start yours from it.</p>
    </div>
    <div class="questions">
      <div class="question"><h3>Will anyone stick up for a stranger?</h3><p>The pizza. This is where Truman started, in 2018.</p><span class="go"><a href="/studies/eatsnap">EatSnap →</a> <a class="try" data-try="eatsnap" href="https://clikbrite.com/join/try-eatsnap" target="_blank" rel="noopener">Try it</a></span></div>
      <div class="question"><h3>Does it matter who flagged a post?</h3><p>Other users, an automated system, or nobody named. From Bhandari et al. (2021).</p><span class="go"><a href="/studies/flag-source">Who flagged this? →</a> <a class="try" data-try="flag-source" href="https://clikbrite.com/join/try-flag-source" target="_blank" rel="noopener">Try it</a></span></div>
      <div class="question"><h3>If everyone seems vaccinated, do you believe more?</h3><p>Profile pictures with a frame on them. From Aghajari et al. (2024).</p><span class="go"><a href="/studies/vaccine-frames">Vaccine frames →</a> <a class="try" data-try="vaccine-frames" href="https://clikbrite.com/join/try-vaccine-frames" target="_blank" rel="noopener">Try it</a></span></div>
      <div class="question"><h3>Is rudeness contagious?</h3><p>Six real people share one town forum. The fake ones start out polite, or don't.</p><a href="/studies/town-talk">Town talk →</a></div>
      <div class="question"><h3>What happens when a pile-on starts?</h3><p>Someone posts her first painting. It goes badly.</p><span class="go"><a href="/studies/bystander">Bystander →</a> <a class="try" data-try="bystander" href="https://clikbrite.com/join/try-bystander" target="_blank" rel="noopener">Try it</a></span></div>
    </div>
  </div>
</section>

<section id="exit">
  <div class="wrap exit">
    <div>
      <div class="head">
        <p class="scene">Is this allowed?</p>
        <h2>It's deception research. There are rules, and Truman is built around them.</h2>
        <p>You can't study how people really act online by asking them. So you build a place and watch, and then you owe them the truth.</p>
      </div>
      <ul>
        <li><b>People agree before they start.</b> Consent is a step you put in the study, with your approved wording.</li>
        <li><b>People find out at the end.</b> The debrief is a page you write, shown when they finish.</li>
        <li><b>People can leave.</b> When someone withdraws, you delete what they did with one click.</li>
        <li><b>The fake people have limits.</b> Anything an AI writes is checked before it's posted, and you can cut it off.</li>
        <li><b>Your ethics board gets <a href="/irb">a page of its own</a></b> that says what's kept and who can see it.</li>
      </ul>
    </div>
    <svg viewBox="0 0 220 200" role="img" aria-label="Stairs rising along a painted sky to an open door">
      <rect width="220" height="200" rx="14" fill="#9dd9ff"/>
      <g stroke="#ffffff" stroke-opacity="0.55"><path d="M0 66h220M0 133h220M73 0v200M147 0v200"/></g>
      <ellipse cx="52" cy="40" rx="30" ry="11" fill="#fff" fill-opacity="0.85"/>
      <ellipse cx="74" cy="48" rx="24" ry="9" fill="#fff" fill-opacity="0.85"/>
      <rect x="160" y="42" width="30" height="58" fill="#10283b"/>
      <path d="M20 180h35v-20h35v-20h35v-20h35v-20h40v80H20z" fill="#6eacd9"/>
      <path d="M20 180h35v-20h35v-20h35v-20h35v-20h40" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="square"/>
    </svg>
  </div>
</section>

<section class="wallband" id="papers">
  <div class="wrap">
    <div class="head">
      <p class="scene">Papers</p>
      <h2>People have been publishing with it since 2018.</h2>
    </div>
    <ul class="papers">
      <li>Zhao et al. (2025). Restorative justice appeals trump retributive vigilance on social media. <i>PNAS Nexus.</i></li>
      <li>Zhao et al. (2024). Standing up to problematic content on social media. <i>Journal of Computer-Mediated Communication.</i></li>
      <li>Aghajari et al. (2024). Do perceived norms really act as a mediator? <i>CHI '24.</i></li>
      <li>Masur, DiFranzo &amp; Bazarova (2021). Behavioral contagion on social media. <i>PLOS ONE.</i></li>
      <li>Taylor et al. (2019). Accountability and empathy by design. <i>CSCW.</i></li>
      <li>DiFranzo et al. (2018). Upstanding by design: bystander intervention in cyberbullying. <i>CHI '18.</i></li>
    </ul>
    <p style="margin-top:1.5rem"><a href="/about">Every paper, and how to cite Truman →</a></p>
  </div>
</section>

<section id="start">
  <div class="wrap">
    <div class="head">
      <p class="scene">Your turn</p>
      <h2>Go build one.</h2>
    </div>
    <div class="ways">
      <div class="way"><h3>Use ours</h3><p>Sign your lab up and start building today. It's free. This is a beta: build, test, and pilot all you like, but hold off on real participants until we say it's ready.</p><div class="actions"><a class="button onpaper" href="https://app.truman-research.org/admin/">Sign your lab up</a> <a class="button quiet" href="/guide/">Read the guide</a></div></div>
      <div class="way"><h3>Run your own</h3><p>It's open source. Put it on your own servers, keep your own data, change whatever you want.</p><div class="actions"><a class="button quiet" href="https://github.com/Critical-Computing-Cadre/truman3">Get the code</a> <a class="button quiet" href="/developers/">Developer docs</a></div></div>
    </div>
  </div>
</section>

<footer>
  <div class="wrap">
    <p><a href="/studies/">Studies</a> · <a href="/guide/">Guide</a> · <a href="/developers/">Developers</a> · <a href="/irb">For IRBs</a> · <a href="/about">About</a> · <a href="https://github.com/Critical-Computing-Cadre/truman3">GitHub</a></p>
    <p>Open source under the MIT license. Truman 3's AI cast builds on Truman Agents, by Qian Yang and the Cornell DesignAI Group.</p>
    <p>The post above, its picture, and the faces are from the EatSnap.Love study. Kitty's comment is from it too, where she left it on someone else's post. The replies to you were written for this page. Nothing you do here is sent anywhere.</p>
  </div>
</footer>
  </div>
</template>

<style>
@keyframes arrive { from { opacity: 0.2; transform: translateY(8px); } }

.truman-home {
  /* Layout: a dark control room looking at a world under glass. The feed lives in the dome. One
     switch turns everyone in it into what they are. Further down, a monitor plays back the visitor. */
  & {
    --room: #0b131a;          /* the control room, the same in both themes */
    --room-soft: #8fa6b6;
    --room-fg: #eef6fb;
    --sky: #9dd9ff;
    --sky-deep: #6eacd9;
    --bot: #5cc4a8;           /* the cast, unmasked */
    --mark: #ff5d8f;          /* the director's pen */
    --phosphor: #6dff9c;      /* the monitor */
    --ink: #10283b;
    --ink-soft: #456176;
    --paper: #ffffff;
    --wall: #f1f7fb;
    --line: #c9dfee;
    --app-bg: #ffffff;
    --app-fg: #151b20;
    --app-soft: #65727c;
    --app-line: #e6eaed;
    --app-wall: #f1f4f6;
    --display: "Gill Sans", "Gill Sans MT", Cabin, "Trebuchet MS", sans-serif;
    --body: "Source Sans 3", "Segoe UI", system-ui, sans-serif;
    --script: "Courier Prime", "Courier New", monospace;
    --hand: Caveat, "Bradley Hand", cursive;
    --app: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    & {
      --ink: #e8f4fc; --ink-soft: #a7c2d6; --paper: #101c27; --wall: #152533; --line: #26425a;
      color-scheme: dark;
    }
  }

  & { background: var(--paper); color: var(--ink); font: 400 1.0625rem/1.6 var(--body); }
  .wrap {
    max-width: 70rem; margin-inline: auto;
    padding-left: max(20px, env(safe-area-inset-left, 0px));
    padding-right: max(20px, env(safe-area-inset-right, 0px));
  }
  a { color: inherit; }
  :focus-visible { outline: 3px solid var(--mark); outline-offset: 3px; }
  h1, h2, h3 { font-family: var(--display); font-weight: 400; margin: 0; text-wrap: balance; }
  p { margin: 0; }

  .room { background: var(--room); color: var(--room-fg); }
  nav { display: flex; align-items: center; gap: 1.25rem; padding-block: 1rem; flex-wrap: wrap; }
  .brand {
    display: flex; align-items: center; gap: 0.6rem; margin-right: auto; text-decoration: none;
    font: 400 1.7rem/1 var(--display); letter-spacing: 0.06em;
  }
  .brand svg { width: 2.1rem; height: 2.1rem; }
  .beta {
    font: 700 0.7rem/1 var(--script); letter-spacing: 0.08em; text-transform: uppercase;
    padding: 0.25rem 0.4rem; border-radius: 0.3rem; border: 1px solid var(--mark); color: var(--mark);
  }
  nav .links { display: flex; gap: 1.2rem; flex-wrap: wrap; }
  nav .links a { text-decoration: none; font-weight: 600; font-size: 0.98rem; color: var(--room-soft); }
  nav .links a:hover { color: var(--room-fg); }
  .button {
    display: inline-block; padding: 0.7rem 1.25rem; border-radius: 999px; text-decoration: none;
    font: 600 1rem/1.2 var(--body); background: var(--sky); color: var(--room); border: 0; cursor: pointer;
  }
  .button.quiet { background: transparent; color: inherit; box-shadow: inset 0 0 0 2px currentColor; }
  .button.small { padding: 0.5rem 1rem; font-size: 0.95rem; }
  .button.onpaper { background: var(--ink); color: var(--paper); }

  .hero {
    display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); gap: 2rem 3rem;
    align-items: center; padding-block: 2rem 0;
  }
  .pitch { display: grid; gap: 1.2rem; padding-bottom: 3rem; }
  h1 { font-size: clamp(2.4rem, 5.4vw, 4rem); line-height: 1.04; font-weight: 300; }
  h1 em { font-style: normal; color: var(--sky); }
  .pitch p { font-size: 1.2rem; color: var(--room-soft); max-width: 31rem; }
  .pitch p b { color: var(--room-fg); font-weight: 600; }
  .actions { display: flex; gap: 0.75rem; flex-wrap: wrap; }
  .pitch p.hand { font: 600 1.9rem/1.1 var(--hand); color: var(--mark); transform: rotate(-2deg); max-width: 24rem; }
  @media (max-width: 860px) { .hero { grid-template-columns: minmax(0, 1fr); } .pitch { padding-bottom: 0; } }

  /* The world under glass. */
  .dome {
    position: relative; border-radius: 50% 50% 0 0 / 30% 30% 0 0; overflow: hidden;
    padding: 22% 9% 0;
    background:
      radial-gradient(70px 26px at 22% 13%, rgba(255,255,255,0.9) 98%, transparent),
      radial-gradient(100px 34px at 30% 16%, rgba(255,255,255,0.9) 98%, transparent),
      radial-gradient(80px 28px at 74% 9%, rgba(255,255,255,0.85) 98%, transparent),
      radial-gradient(60px 22px at 82% 22%, rgba(255,255,255,0.85) 98%, transparent),
      linear-gradient(#6fbdf0, #cfeaff 70%, #e9f6ff);
    box-shadow: inset 0 0 0 3px rgba(255,255,255,0.55), inset 0 0 60px rgba(255,255,255,0.35), 0 0 80px rgba(110,172,217,0.35);
  }
  .dome::before {   /* the shine on the glass */
    content: ""; position: absolute; inset: 2% 55% 62% 8%; border-radius: 50%;
    border-top: 6px solid rgba(255,255,255,0.65); transform: rotate(-24deg); pointer-events: none;
  }
  .base { margin-bottom: 2.5rem; height: 1.1rem; border-radius: 0 0 50% 50% / 0 0 100% 100%; background: linear-gradient(#2a3a47, #05090c); }

  .app {
    font-family: var(--app); background: var(--app-bg); color: var(--app-fg); position: relative;
    border-radius: 1.1rem 1.1rem 0 0; box-shadow: 0 -6px 30px rgba(16,60,100,0.3); overflow: hidden;
    font-size: 0.95rem; line-height: 1.4;
  }
  .appbar {
    display: flex; justify-content: space-between; align-items: center; padding: 0.7rem 1rem;
    border-bottom: 1px solid var(--app-line); font-weight: 700; font-size: 1.05rem;
  }
  .appbar span { font-weight: 400; font-size: 0.8rem; color: var(--app-soft); }
  .post { padding: 0.9rem 1rem 0.6rem; display: grid; gap: 0.6rem; }
  .who { display: flex; gap: 0.6rem; align-items: center; }
  .name { font-weight: 700; }
  .time { color: var(--app-soft); font-size: 0.85rem; }
  .photo { width: 100%; aspect-ratio: 16 / 10; object-fit: cover; border-radius: 0.7rem; display: block; }
  .counts { color: var(--app-soft); font-size: 0.85rem; }
  .acts button, .bubble button {
    font: 600 0.85rem/1 var(--app); color: var(--app-soft); background: none; border: 0; padding: 0.2rem 0; cursor: pointer;
  }
  .acts button[aria-pressed="true"] { color: #d6336c; }
  .comments { display: grid; gap: 0.65rem; padding: 0 1rem 0.9rem; }
  .comment { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.55rem; }
  .bubble { background: var(--app-wall); border-radius: 0.9rem; padding: 0.5rem 0.75rem; min-width: 0; }
  .bubble .row { display: flex; gap: 0.9rem; margin-top: 0.15rem; align-items: center; }
  .bubble .flagged { font-size: 0.8rem; color: var(--app-soft); }
  .comment.new { animation: arrive 0.5s ease-out; }
  .compose { display: flex; gap: 0.5rem; padding: 0.7rem 1rem; border-top: 1px solid var(--app-line); }
  .compose input {
    flex: 1; min-width: 0; font: inherit; padding: 0.55rem 0.9rem; border-radius: 999px;
    border: 1px solid var(--app-line); background: var(--app-wall); color: var(--app-fg);
  }
  .compose button {
    font: 700 0.9rem/1 var(--app); padding: 0 1rem; border-radius: 999px; border: 0; cursor: pointer;
    background: var(--sky-deep); color: #fff;
  }

  /* A face, and the robot behind it. */
  .face { width: 2.2rem; height: 2.2rem; flex: none; position: relative; }
  .face.small { width: 1.8rem; height: 1.8rem; }
  .face img, .face .you, .face svg { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 50%; }
  .face img { object-fit: cover; }
  .face .you { display: grid; place-items: center; background: #3a7ca5; color: #fff; font-weight: 700; font-size: 0.8rem; }
  .face svg { opacity: 0; transform: scale(0.4) rotate(-30deg); transition: opacity 0.25s, transform 0.35s; }
  .revealed .face svg { opacity: 1; transform: none; }
  .revealed .face img { opacity: 0; }
  .revealed .cast .name { color: #1c8a6f; }
  @media (prefers-reduced-motion: reduce) { .face svg { transition: none; } .comment.new { animation: none; } }

  .tag {
    display: none; font: 700 0.66rem/1 var(--script); letter-spacing: 0.05em; text-transform: uppercase;
    padding: 0.2rem 0.35rem; border-radius: 0.25rem; color: #b3245a; border: 1px dashed #d6336c; background: #fff0f5;
  }
  .tag.real { color: #0a7d4f; border: 1px solid #0a7d4f; background: #fff; }
  .revealed .tag { display: inline-block; }

  .controls { display: flex; gap: 0.8rem 1rem; flex-wrap: wrap; align-items: center; padding-block: 0 1.1rem; }
  .switch {
    font: 700 0.9rem/1 var(--script); letter-spacing: 0.04em; text-transform: uppercase; cursor: pointer;
    padding: 0.7rem 1rem; border-radius: 0.4rem; background: transparent; color: var(--room-fg); border: 2px solid var(--room-fg);
  }
  .switch[aria-pressed="true"] { background: var(--bot); border-color: var(--bot); color: var(--room); }
  .condition { display: none; font: 400 0.85rem/1.2 var(--script); gap: 0.4rem; align-items: center; color: var(--room-soft); }
  .revealed .condition { display: flex; }
  .condition select { font: inherit; padding: 0.35rem 0.4rem; border-radius: 0.3rem; border: 1px solid var(--room-soft); background: var(--room); color: var(--room-fg); }
  .hint { font: 400 0.9rem/1.4 var(--script); color: var(--room-soft); }

  section { padding-block: 3.75rem; }
  .wallband { background: var(--wall); }
  .scene { font: 700 0.85rem/1 var(--script); letter-spacing: 0.08em; text-transform: uppercase; color: var(--sky-deep); }
  h2 { font-size: clamp(1.9rem, 4vw, 2.7rem); line-height: 1.1; font-weight: 300; }
  .head { display: grid; gap: 0.7rem; margin-bottom: 2.2rem; max-width: 44rem; }
  .head p:last-child { color: var(--ink-soft); font-size: 1.12rem; }

  .looks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2rem; }
  .looks a { display: grid; gap: 0.3rem; color: inherit; text-decoration: none; }
  .looks img { width: 100%; height: auto; border-radius: 0.6rem; border: 1px solid var(--line); box-shadow: 0 10px 30px rgb(0 0 0 / 0.12); margin-bottom: 0.5rem; transition: transform 0.2s; }
  .looks a:hover img { transform: translateY(-3px); }
  .looks b { font-size: 1.3rem; font-weight: 600; }
  .looks span { color: var(--ink-soft); }
  @media (max-width: 760px) { .looks { grid-template-columns: minmax(0, 1fr); } }
  @media (prefers-reduced-motion: reduce) { .looks img { transition: none; } }

  .parts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2rem 3.5rem; }
  .part { display: grid; gap: 0.35rem; align-content: start; }
  .part h3 { font-size: 1.5rem; }
  .part p { color: var(--ink-soft); }
  .part q { font-family: var(--script); font-size: 0.95rem; color: var(--ink); quotes: none; }
  @media (max-width: 760px) { .parts { grid-template-columns: minmax(0, 1fr); } }

  /* The monitor: a hidden camera's view of the visitor. */
  .watch { display: grid; grid-template-columns: minmax(0, 4fr) minmax(0, 5fr); gap: 2.5rem; align-items: center; }
  .watch .head { margin: 0; }
  .watch .head p:last-child { color: var(--room-soft); }
  .watch .scene { color: var(--phosphor); }
  .monitor { background: #20262b; border-radius: 1.6rem; padding: 1.1rem; box-shadow: inset 0 0 0 2px #39424a, 0 20px 50px rgba(0,0,0,0.5); }
  .screen {
    border-radius: 1rem; padding: 1.2rem 1.3rem; min-height: 16rem; color: var(--phosphor);
    font: 400 0.98rem/1.55 var(--script); text-shadow: 0 0 6px rgba(109,255,156,0.5);
    background:
      repeating-linear-gradient(0deg, rgba(0,0,0,0.28) 0 1px, transparent 1px 3px),
      radial-gradient(120% 90% at 50% 40%, #0f2a1c, #04100a);
  }
  .screen .rec { display: flex; justify-content: space-between; margin-bottom: 0.7rem; font-weight: 700; }
  .screen dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.2rem 1.2rem; margin: 0; }
  .screen dd { margin: 0; overflow-wrap: anywhere; min-width: 0; }
  .screen dt { opacity: 0.7; }
  .after { margin-top: 1rem; color: var(--room-soft); font-size: 1rem; }
  @media (max-width: 860px) { .watch { grid-template-columns: minmax(0, 1fr); } }

  .questions { border-top: 1px solid var(--line); }
  .question {
    display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 6fr) auto; gap: 0.4rem 2rem;
    align-items: baseline; padding-block: 1.05rem; border-bottom: 1px solid var(--line);
  }
  .question h3 { font-size: 1.35rem; }
  .question p { color: var(--ink-soft); }
  .question a { font: 700 0.9rem/1.2 var(--script); white-space: nowrap; }
  .question .go { display: flex; gap: 0.9rem; align-items: baseline; white-space: nowrap; }
  .question a.try { padding: 0.3rem 0.75rem; border-radius: 999px; background: var(--ink); color: var(--paper); text-decoration: none; }
  @media (max-width: 760px) { .question { grid-template-columns: minmax(0, 1fr); } }

  .exit { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 2.5rem; align-items: center; }
  .exit svg { width: 100%; max-width: 22rem; justify-self: center; }
  .exit ul { margin: 0; padding-left: 1.1rem; color: var(--ink-soft); display: grid; gap: 0.4rem; }
  .exit li b { color: var(--ink); }
  @media (max-width: 760px) { .exit { grid-template-columns: minmax(0, 1fr); } }

  .papers { display: grid; gap: 0.8rem; padding: 0; margin: 0; list-style: none; max-width: 52rem; }
  .papers i { color: var(--ink-soft); }
  .ways { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.5rem; }
  .way { display: grid; gap: 0.8rem; align-content: start; padding: 1.6rem; border: 2px solid var(--ink); border-radius: 0.8rem; }
  .way p { color: var(--ink-soft); }
  @media (max-width: 760px) { .ways { grid-template-columns: minmax(0, 1fr); } }
  footer { padding-block: 2.2rem; color: var(--ink-soft); font-size: 0.95rem; border-top: 1px solid var(--line); }
  footer .wrap { display: grid; gap: 0.5rem; }
}
</style>
