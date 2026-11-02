# Connecting a study to Prolific and a survey

The goal is that participants never have to type or copy an ID. Each system passes it to the next through the link, which is one less place for someone to make a mistake.

These steps use Qualtrics and Prolific. Other survey tools work the same way if they can read a value from their link. Those products change, so **always test with their preview links before launching.**

## How the ID travels

```
Prolific ──► Truman 3 ──► Qualtrics ──► back to Prolific
        link         exit link     completion link
```

If your study has a pre-survey, it goes first:

```
Prolific ──► Qualtrics ──► Truman 3 ──► Qualtrics ──► back to Prolific
```

## 1. Prolific to Truman 3

In `study.yaml`:

```yaml
entry:
  idParam: PROLIFIC_PID # the name of the value in the link
  idLabel: Prolific ID # what to call it if someone has to type it
  source: prolific
```

In Prolific, under data collection:
1. Set the study URL to `https://YOUR-SITE/join/YOUR-STUDY-SLUG`.
2. Choose **I'll use URL parameters**. Prolific adds `PROLIFIC_PID` to the link for each person.

The name in `idParam` has to match the link exactly, including capital letters. If the ID isn't in the link, Truman 3 asks for it instead.

Prolific also adds `STUDY_ID` and `SESSION_ID`. Truman 3 ignores them, so they're safe to leave in or remove.

## 2. Truman 3 to Qualtrics

Put the survey link in the exit step of `study.yaml`, with `{externalId}` where the ID goes:

```yaml
flow:
  - step: feed
  - step: exit
    redirect: "https://YOUR-ORG.qualtrics.com/jfe/form/SV_XXXX?PROLIFIC_PID={externalId}&USER_ID={participantId}"
```

| In the link       | Becomes                                                       |
| ----------------- | ------------------------------------------------------------- |
| `{externalId}`    | Their recruitment ID, such as their Prolific ID               |
| `{participantId}` | The ID in your Truman 3 export, which isn't their Prolific ID |

**Include both.** The names in the link are yours to choose, but participants can see them in the address bar, so keep them neutral if your study has a cover story. `USER_ID` is what you'll use to match survey answers to study data without handling Prolific IDs. `pnpm study validate` warns you if the link passes on neither.

In Qualtrics, so the survey keeps these values:
1. Open **Survey flow**.
2. Add an **Embedded Data** element, and drag it to the very top.
3. Add two fields, named exactly `PROLIFIC_PID` and `USER_ID`. Capital letters have to match the link. Leave their values empty, set to come from the URL.
4. Save the flow.

The values are now saved with each response, and appear as columns in your data.

## 3. Qualtrics back to Prolific

So people get credit without typing a completion code:
1. In Prolific, copy the redirect link from the **Completion paths** section.
2. In Qualtrics, open the **End of Survey** element, and choose to redirect to a URL.
3. Paste in the link.

## With a pre-survey

Make the Qualtrics survey the study URL in Prolific, with `PROLIFIC_PID` saved as in step 2. Then have it send people on to Truman 3. Use this in its End of Survey redirect:

```
https://YOUR-SITE/join/YOUR-STUDY-SLUG?PROLIFIC_PID=${e://Field/PROLIFIC_PID}
```

Qualtrics fills in `${e://Field/PROLIFIC_PID}` with the saved value. Use a second survey for after Truman 3.

**Consent in this setup.** If consent is in your pre-survey, people who don't agree should end there and never reach Truman 3. Leave the `consent` step out of `study.yaml`.

## If someone doesn't consent

Ideally, people who don't consent never join. If your consent is in Truman 3 and someone declines, it's treated like a withdrawal: their data is deleted, and that ID can't enter the study again. Your codebook counts how many people declined.

They hold a place on Prolific until they return their submission, so tell them to:

```yaml
flow:
  - step: consent
    page: pages/consent.md
    declineMessage: "Thanks for considering this. Please return your submission on Prolific."
```

Use `declineRedirect` instead to send them to a link.

## Check it before launching

A study isn't open to participants until it's launched, either from the admin app or with `pnpm study launch`. Until then, the study link won't let anyone in, so use **Try as a participant** in the admin app. Test participants stay out of your exports.

Then check the whole path with real links. Launch it, but don't publish it on Prolific yet:

1. Run `pnpm study validate` and read any warnings.
2. Open your link yourself with a made-up ID: `https://YOUR-SITE/join/YOUR-STUDY-SLUG?PROLIFIC_PID=TEST123`.
3. Go through to the end. **Use a new ID each time,** because finishing locks that ID out.
4. In your Qualtrics data, confirm `TEST123` is in the `PROLIFIC_PID` column.
5. Run `pnpm study export`, and confirm that the response's `USER_ID` is in `participants.csv`.
6. Use Prolific's preview to check that its redirect works.

Before you share data: exports leave out Prolific IDs, but your survey data will now contain them. Remove that column before sharing.

## Further reading

- [Prolific's Qualtrics integration guide](https://researcher-help.prolific.com/en/articles/445194-qualtrics-integration-guide)
- [Qualtrics on passing information through query strings](https://www.qualtrics.com/support/survey-platform/survey-module/survey-flow/standard-elements/passing-information-through-query-strings/)
