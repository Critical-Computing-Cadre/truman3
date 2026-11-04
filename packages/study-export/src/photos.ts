import { type Database, schema } from "@truman3/db";
import { and, eq, isNotNull } from "drizzle-orm";

export interface ParticipantPhoto {
  key: string;
  /** The same ID the data uses for them. */
  participantId: string;
  kind: "post" | "profile";
  /** The post it's on. Empty for a profile picture. */
  contentId: string;
}

/**
 * What participants have uploaded and still have in the study. A researcher trying the study isn't
 * data, and neither is a picture someone has since replaced.
 */
export async function listParticipantPhotos(
  db: Database,
  studyId: string,
): Promise<ParticipantPhoto[]> {
  const members = await db
    .select({
      worldId: schema.worldMemberships.worldId,
      participantId: schema.participants.id,
      profile: schema.actors.profile,
    })
    .from(schema.participants)
    .innerJoin(
      schema.worldMemberships,
      eq(schema.worldMemberships.participantId, schema.participants.id),
    )
    .innerJoin(schema.actors, eq(schema.actors.id, schema.worldMemberships.actorId))
    .where(and(eq(schema.participants.studyId, studyId), eq(schema.participants.isPilot, false)));
  const participantByWorld = new Map(members.map((m) => [m.worldId, m.participantId]));

  const photos: ParticipantPhoto[] = [];
  for (const { profile, participantId } of members) {
    const { picture } = profile as { picture?: string };
    if (picture?.startsWith("uploads/")) {
      photos.push({ key: picture, participantId, kind: "profile", contentId: "" });
    }
  }

  const posts = await db
    .select({
      id: schema.content.id,
      worldId: schema.content.worldId,
      attachments: schema.content.attachments,
    })
    .from(schema.content)
    .innerJoin(schema.studyVersions, eq(schema.studyVersions.id, schema.content.studyVersionId))
    .where(and(eq(schema.studyVersions.studyId, studyId), isNotNull(schema.content.worldId)));

  for (const post of posts) {
    const participantId = participantByWorld.get(post.worldId as string);
    if (!participantId) {
      continue;
    }
    for (const { key } of post.attachments) {
      if (key.startsWith("uploads/")) {
        photos.push({ key, participantId, kind: "post", contentId: post.id });
      }
    }
  }
  return photos;
}
