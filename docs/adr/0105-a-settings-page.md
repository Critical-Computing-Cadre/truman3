# 105. A settings page

## Context

Every app a study stands for has a settings page: who's signed in, then a list of lines with an icon and an arrow. A participant looking for one found nothing. The only page of their own was "Edit your profile", reached from a button on their profile, with the browser's bare "Choose File" control for their picture. This is the second part of making a site behave like an app on a phone (ADR 104), from Dominic's note: "Plus profile page, settings, etc."

A study has little a participant can really set. What it does have was scattered: editing a profile, saved posts on their own page, and the rules, terms, and privacy pages in a menu or the small print.

## Decision

- **A page at `/settings`,** on every kind of site, at every width. A cog beside "Edit profile" on a participant's own profile opens it.
  - At the top, their picture, name, and username.
  - **Lines that open the study's real pages,** only the ones this study has: Edit profile, Saved posts, Community rules, Mod log, Terms of service, Privacy policy.
  - **Lines that are only for show,** under those: Privacy and security, Notifications, Appearance, Languages, Accessibility, Help. They work as everything for show does (ADR 77): pressing one says it isn't available right now, and the press is recorded. They're in each layout's list (`SETTINGS_DECOR` in `packages/core`), under "Settings page", so a study can hide any of them in the builder. With `decor` off there are none.
  - The study's small print is at the bottom.
- **"Settings" in a menu opens it.** Short posts' menu has a Settings line, and Photo's and Short video's have More. They opened the page for editing a profile. Now they open this (`opens: "settings"`).
- **Pages one step in have an arrow back** at the top with the page's name (`BackBar`): Settings, and Edit your profile. The arrow goes wherever they came from.
- **Choosing a profile picture or banner is a button,** "Choose a photo" or "Change photo", with the picture they chose shown before they save.
- **On Photo and Short video, a profile's counts are a number over its word on a phone,** spread across the row.

## Alternatives considered

- **Settings that really change things,** such as a dark mode or turning notifications off. A participant who changes how their site looks or what reaches them has left their condition. A study chooses those (ADR 76), and what a participant sees stays what the study set.
- **A different list of for-show lines for each kind of site.** Real apps' settings differ in the details, but the same six cover all of them, and one list is one thing for a researcher to learn.
- **Leaving the lines for show out,** so the page has only what's real. On a study with no rules or terms that's a page with one line on it, which looks broken.

## Consequences

- A study that counts presses on things for show (`decor.pressed`) has six more keys it can see, all starting `settings-`.
- A study that hid Short posts' Settings line, or Photo's More, still has it hidden. One that left it has a line that opens a different page than it did.
- Nothing here lets a participant leave a study or delete their data. That's still done through the researcher (`pnpm study withdraw`).
