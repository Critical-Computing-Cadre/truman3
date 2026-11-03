# 21. The API has its own database login, and the admin app lives under a path

**Status:** Accepted. Replaces what ADR 19 says about the admin app's address.

## The admin app's address

ADR 19 gave the admin app its own address, so that `eatsnap.love/admin` wouldn't show a research tool on a study's domain. Dominic's view is that it depends on the deployment: a lab hosting for itself, or a hosted version for many labs, may choose either, and it's a choice about their own DNS. A participant who finds `/admin` just can't get in.

**Decision: the admin app is always built for `/admin/`, and what's in front of it decides where that is.** One build works on an address of its own, on a community's domain, or on some domains and not others. There's no setting in the app.

The cost is that an address of its own reads `admin.yourlab.edu/admin/`, and needs a redirect from `/`.

**What sharing an address changes:**
- **Cookies don't interfere.** The two apps use separate names, each route reads only its own, and signing out of one leaves the other. Tests cover this, and that a participant is refused on every admin route.
- **Pages share an origin.** A script running on a participant page could call the admin API as a researcher signed in on that browser. Today nothing puts scripts on those pages, since researchers can't add code (ADR 18), so a flaw would have to be a real bug in how the app handles text. A lab that wants that risk removed can use a separate address.
- **Participants can see the sign-in form,** and that the site is built on Truman. That matters if a study's cover story depends on it. Then leave `/admin/*` off that domain.

## The API's database login

The rules protecting a study's data, such as events being append-only, are triggers. Whoever owns a table can turn its triggers off, so with one login they only guarded against accidents.

**Decision: the database update runs as the owner, and the API runs as `truman_app`,** which owns nothing and can't change tables, truncate, or disable triggers. After every migration, the update starts that login from nothing and grants it rights again, so a new table is always covered. It isn't a numbered migration because the login and its password belong to a deployment, and because that repeats it after later migrations.

**`truman_app` can only read and add to append-only tables,** found by asking the database which tables use the `forbid_change` trigger. That trigger lets deletions through when a setting is on, and any login can turn on a setting like that, so the trigger alone doesn't stop this login.

**Withdrawal runs with its owner's rights** (`SECURITY DEFINER`), and it's the only way this login can delete those rows. The update sets that on `delete_participant_data` each time, because replacing the function in a migration would clear it.

**The API refuses to start in production as an owner or superuser,** so a wrong setting shows up immediately.

**Tests connect as `truman_app`,** in every integration and browser test, so something that only works as the owner fails before production. `rules.itest.ts` connects as the owner, because it tests the triggers themselves.

### Alternatives

- **Writing this in a numbered migration.** It wouldn't reach tables added later unless each migration remembered to, and it would need a password in the repo or a separate way to set it.
- **Default privileges** (`ALTER DEFAULT PRIVILEGES`). These apply to tables made later, but they'd give new append-only tables full rights until something took them away, and they don't help with existing ones.
- **Changing `forbid_change` to check who's calling.** It would need a migration and still leave the login able to attempt deletes. Taking the right away is simpler to check.

### Consequences

- Anyone with the owner's login can still change anything. This limits the running API, not people who hold that login.
- `truman_app` can still update and delete other tables, such as `participants`, because the API has to. Frozen versions are still guarded by their triggers, which have no setting to turn on.
- A database update now needs `DATABASE_APP_PASSWORD` the first time, on a real deployment.
