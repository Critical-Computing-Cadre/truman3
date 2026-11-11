# Templates for a study's site

A study's site can have its own **terms of service** and **privacy policy**, as real platforms do, so it seems more believable. Set them in `study.yaml`, and copy these to start:

```yaml
site:
  name: Commons
  terms: pages/terms.md
  privacy: pages/privacy.md
```

They show as links at the bottom of every page (ADR 67). Change the site's name and addresses to the study's.

**These are part of the study's fiction.** They aren't the real terms of the research, which belong in the consent page and the debriefing, approved by your ethics board. If the fake terms say anything about data that differs from what really happens, say so in the debriefing, and check that your board is comfortable with them.
