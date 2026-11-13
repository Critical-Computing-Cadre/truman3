# 80. A limit on how much a lab's participants upload

## Context

A hosted Truman pays for what's stored. A lab's limits (ADR 70) covered participants, open studies, and Claude, and nothing covered storage. ADR 79 started recording each upload's size, which is what a limit needs.

## Decision

- **A lab has a limit, `uploadsGb`, on what its participants have uploaded** across all its studies and that's still stored. A hosted lab starts with 5 GB when it's approved. An operator changes it on the Labs page, which also shows what each lab is using. No number means no limit, as for a team made on the server.
- **At the limit, an upload is refused.** The participant sees what they see for a photo that can't be used. The post or profile isn't saved without its photo: they can try again without one.
- **The Demos team (ADR 78) gets 1 GB.** Anyone can upload there, and a visit is kept a week. The server gives the team this limit when it starts if it has none, and leaves a number an operator set.
- **Deleting gives the room back.** The count is the `uploads` rows that exist, and those go with a participant's data and with a study.
- **Only participants' uploads count.** A study's own pictures are stored once by their contents and can be shared by many studies and labs, so they have no single owner to charge. They're also small beside what thousands of participants can upload.

## Alternatives considered

- **Counting everything a lab stores,** its studies' pictures included. See above. It would need each stored picture to know every lab that uses it.
- **Telling the participant the lab is out of room.** That's the lab's business, and it tells a participant they're in something run by a lab.
- **Warning the lab before it's full.** Worth doing, by email at 80% say. Not in this change: a lab doesn't yet see its own usage anywhere, and that page should come first.
- **A limit for each study.** One more number for a researcher to manage, when the cost is the lab's.

## Consequences

- Labs approved before this have no limit until an operator gives them one.
- Uploads from before ADR 79 have no row, so they aren't counted.
- A lab can't see how much it's using. The operator can. A lab that hits the limit finds out from a participant or a pilot.
- Two uploads at the same moment can both fit under the limit and together pass it, by one photo.
