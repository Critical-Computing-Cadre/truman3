import {
  CreateAliasCommand,
  CreateKeyCommand,
  DecryptCommand,
  GenerateDataKeyCommand,
  KMSClient,
} from "@aws-sdk/client-kms";
import type { KeyService } from "./lab-keys.ts";

/**
 * The policy on a lab's key (ADR 82). The account keeps control of the key, as AWS requires for it
 * to be manageable at all. Using it is refused to everyone but the roles named: this server's, and
 * the emergency role's. An administrator's everyday login is refused, whatever its own permissions
 * say. Changing this policy is possible for the account's owner, and AWS records it.
 */
export function labKeyPolicy(accountId: string, mayUse: string[]): string {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "TheAccountManagesTheKey",
        Effect: "Allow",
        Principal: { AWS: `arn:aws:iam::${accountId}:root` },
        Action: "kms:*",
        Resource: "*",
      },
      {
        Sid: "OnlyTheseUseTheKey",
        Effect: "Deny",
        Principal: "*",
        Action: ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey*", "kms:ReEncrypt*"],
        Resource: "*",
        Condition: { ArnNotLike: { "aws:PrincipalArn": mayUse } },
      },
    ],
  });
}

/**
 * Labs' keys in AWS KMS: one key for each lab, tagged with the stage it belongs to, which is what
 * this server's own permissions are limited to.
 */
export function kmsKeyService({
  region,
  stage,
  mayUse,
  client = new KMSClient({ region }),
}: {
  region: string;
  /** Such as "truman3-production". Keys are tagged and named with it. */
  stage: string;
  /** The roles that may use a lab's key, as ARNs: this server's own, and the emergency role's. */
  mayUse: string[];
  client?: Pick<KMSClient, "send">;
}): KeyService {
  const accountId = mayUse[0]?.split(":")[4];
  if (!accountId) {
    throw new Error("LAB_KEY_ROLES has to name this server's own role, as an ARN.");
  }
  return {
    encryptsStorage: true,
    async create(team) {
      const made = await client.send(
        new CreateKeyCommand({
          Description: `Truman: the key for the lab "${team.slug}"`,
          Policy: labKeyPolicy(accountId, mayUse),
          // KMS refuses a policy that wouldn't let whoever makes the key change that policy later.
          // That's on purpose here: this server makes the key and should never be able to change
          // who may use it. The account still can, through the first statement.
          BypassPolicyLockoutSafetyCheck: true,
          Tags: [
            { TagKey: "truman-stage", TagValue: stage },
            { TagKey: "truman-team", TagValue: team.id },
          ],
        }),
      );
      const keyId = made.KeyMetadata?.Arn;
      if (!keyId) {
        throw new Error("The key service didn't make a key.");
      }
      // A name to find it by in the console. The team's ID, since a slug can hold what a name can't.
      await client.send(
        new CreateAliasCommand({ AliasName: `alias/${stage}-lab-${team.id}`, TargetKeyId: keyId }),
      );
      const data = await client.send(
        new GenerateDataKeyCommand({ KeyId: keyId, KeySpec: "AES_256" }),
      );
      if (!data.CiphertextBlob) {
        throw new Error("The key service didn't make a data key.");
      }
      return { keyId, wrappedDataKey: Buffer.from(data.CiphertextBlob).toString("base64") };
    },
    async unwrap(keyId, wrappedDataKey) {
      const opened = await client.send(
        new DecryptCommand({ KeyId: keyId, CiphertextBlob: Buffer.from(wrappedDataKey, "base64") }),
      );
      if (!opened.Plaintext) {
        throw new Error("The key service didn't open the data key.");
      }
      return Buffer.from(opened.Plaintext);
    },
  };
}
