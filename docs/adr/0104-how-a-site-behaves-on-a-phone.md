# 104. How a site behaves on a phone

## Context

Most participants are on a phone, in a browser or in Truman's app (ADR 66). The six kinds of site already rearranged themselves at a phone's width, but they behaved like a web page made narrow, and not like the apps they stand for. Dominic's notes, with 69 screenshots of real apps for comparison:

- "The top/bottom menu should disappear when scrolling and come back when scrolling up."
- Writing a post was a small window in the middle of the screen titled "Add a New Post", the same on every kind of site. In real apps it's a whole screen, with the button that sends it in the top corner.
- Classic had its sections in a second row under its top bar, where the other kinds have them along the bottom.

A study is meant to feel like a kind of platform without copying a real one (ADR 76). What apps share, such as where things are and how they move, is what's taken here. No real app's name, wording, icons, or colors are.

ADR 18 says a layout's look can't change once a study has launched with it. Truman 3 is still in beta (`v3.0.0-beta.1`) and no study has run with real participants, so this changes the layouts in place, as ADR 76 did.

## Decision

- **Bars slide away going down the page, and come back going up.** `useBarsThatHide` in `packages/ui` watches which way the page last moved and puts `data-bars="hidden"` on the page. `skins.css` slides anything marked `data-bar="top"` or `data-bar="bottom"`, only below 768 pixels wide.
  - Near the top of a page the bars always show. A move of a few pixels changes nothing, so they don't flicker.
  - A bar someone has moved into with a keyboard stays where it is.
  - With "reduce motion" on, they go and come back without sliding.
  - Short video keeps its bars: it shows one video at a time and the page itself never scrolls.
- **Classic's sections run along the bottom on a phone,** like the other five.
- **Writing a post fills the screen on a phone.** It's still one form (`NewPostDialog`), and a window in the middle on a wider screen.
  - Across the top: a way out, what this kind of site calls it, and **Post** in the corner, where a phone's keyboard can't cover it.
  - The boxes to write in have no outlines. Choosing a photo is an icon in a bar along the bottom, with how many characters are left. The chosen photo shows under the words, with a cross to take it off.
  - Each kind words it its own way (`PHONE_LOOK`): Classic and Video say "Create post" over the person's picture and name. Short posts has "Cancel", and their picture beside the words. Photo and Short video say "New post", and choosing the photo comes first. Forum has the community at the top, then a large title.
  - To a screen reader and to tests it's the same on all six: a dialog named "Add a New Post", with a button named "Post".
- **Some kinds start a post from their own bars on a phone,** on any page: a round button over the posts on Short posts, a "Create" tab in the middle of the bottom bar on Forum and Video, and a plus in the top corner on Photo. Each is a button named "Compose". They're only there where the participant can post. Classic and Short video keep the one they had at the top of the feed.
- **The page shrinks when a phone's keyboard opens** (`interactive-widget=resizes-content` in the page's viewport), so the bar along the bottom of the writing screen stays above the keys. Safari on iPhones doesn't support this yet, and there the bar can sit under the keyboard. Post is at the top for that reason.

## Alternatives considered

- **Screens drawn by the app itself,** in React Native. They'd feel most like an app, but the app is a shell on purpose (ADR 66): one site to build, test, and keep the same for people in a browser and people in the app. Two versions of every screen could drift apart, and a study couldn't say its participants all saw the same thing.
- **Hiding the bars from the app's side,** by watching the page scroll from outside. It would do nothing for people in a browser, who are most participants.
- **Separate forms for phone and wide screens.** Two places for every rule about what a post can have. One form, arranged twice, can't disagree with itself.
- **Toggles in the writing screen's bottom bar for a link, a poll, or a place,** as some apps have. They'd hide what a study turned on behind an icon a participant might never press. They stay in view, under the words.

## Consequences

- A participant's own profile, settings, comments, notifications, and messages still look like narrow web pages. They're next.
- Forum's bottom bar has six tabs on a phone when communities, notifications, and messages are all on, and the longer names are cut short.
- A screenshot of a phone's feed, in docs or a paper, now has no bars if it was taken partway down the page.
- From the first real study on, ADR 18 holds: changes like these need a new layout name.
