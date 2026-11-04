export { hasPlaceholderConsent, STARTING_CONSENT } from "./consent.ts";
export {
  type ActorDefinition,
  actorDefinitionSchema,
  type CommentDefinition,
  commentDefinitionSchema,
  type PostDefinition,
  postDefinitionSchema,
  type ReactionDefinition,
  reactionDefinitionSchema,
  type SpaceDefinition,
  type StudyDefinition,
  type StudySettings,
  studyDefinitionSchema,
  studySettingsSchema,
} from "./definition.ts";
export { fillLinkTemplate, LINK_PLACEHOLDERS } from "./links.ts";
export {
  type CommentBox,
  canJoinSpacesFor,
  canSortFor,
  checkNewPost,
  commentBoxFor,
  featureOn,
  featuresFor,
  freezePlatform,
  layoutFor,
  type PlatformStyle,
  type PlatformView,
  platformFor,
  platformStyleFor,
} from "./platform.ts";
export { formatStudyTime, parseStudyTime } from "./time.ts";
export { hasErrors, type StudyIssue, validateStudy } from "./validate.ts";
