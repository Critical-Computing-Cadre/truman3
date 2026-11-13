import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isSealed, sealerFor } from "./lab-keys.ts";
import { kmsKeyService, labKeyPolicy } from "./lab-keys-kms.ts";

describe("sealing with a lab's key (ADR 82)", () => {
  const sealer = sealerFor(randomBytes(32));

  it("gives back what it sealed, and never the same sealed text twice", () => {
    const sealed = sealer.seal("5f3a9c-prolific");
    expect(isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain("5f3a9c");
    expect(sealer.open(sealed)).toBe("5f3a9c-prolific");
    expect(sealer.seal("5f3a9c-prolific")).not.toBe(sealed);
  });

  it("hands back a value that was never sealed, so older rows still read", () => {
    expect(sealer.open("5f3a9c-prolific")).toBe("5f3a9c-prolific");
  });

  it("won't open what's been changed, or what another lab sealed", () => {
    const sealed = sealer.seal("203.0.113.9");
    const changed = `${sealed.slice(0, -2)}${sealed.endsWith("AA") ? "BB" : "AA"}`;
    expect(() => sealer.open(changed)).toThrow();
    expect(() => sealerFor(randomBytes(32)).open(sealed)).toThrow();
  });

  it("makes the same stand-in for the same ID, which another lab's key wouldn't", () => {
    expect(sealer.lookup("abc")).toBe(sealer.lookup("abc"));
    expect(sealer.lookup("abc")).not.toBe(sealer.lookup("abd"));
    expect(sealer.lookup("abc")).not.toBe(sealerFor(randomBytes(32)).lookup("abc"));
    expect(sealer.lookup("abc")).not.toContain("abc");
  });
});

describe("a lab's key in AWS KMS", () => {
  const SERVER = "arn:aws:iam::123456789012:role/truman3-test-api";
  const EMERGENCY = "arn:aws:iam::123456789012:role/truman3-test-emergency";

  it("refuses the key's use to everyone but the roles named", () => {
    const policy = JSON.parse(labKeyPolicy("123456789012", [SERVER, EMERGENCY]));
    expect(policy.Statement).toContainEqual({
      Sid: "OnlyTheseUseTheKey",
      Effect: "Deny",
      Principal: "*",
      Action: ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey*", "kms:ReEncrypt*"],
      Resource: "*",
      Condition: { ArnNotLike: { "aws:PrincipalArn": [SERVER, EMERGENCY] } },
    });
  });

  it("makes a key tagged for its stage and team, and a data key the key wraps", async () => {
    const asked: { name: string; input: Record<string, unknown> }[] = [];
    const service = kmsKeyService({
      region: "us-east-1",
      stage: "truman3-test",
      mayUse: [SERVER],
      client: {
        send: (async (command: {
          constructor: { name: string };
          input: Record<string, unknown>;
        }) => {
          asked.push({ name: command.constructor.name, input: command.input });
          if (command.constructor.name === "CreateKeyCommand") {
            return { KeyMetadata: { Arn: "arn:aws:kms:us-east-1:123456789012:key/k1" } };
          }
          if (command.constructor.name === "GenerateDataKeyCommand") {
            return { CiphertextBlob: new Uint8Array([1, 2, 3]) };
          }
          if (command.constructor.name === "DecryptCommand") {
            return { Plaintext: new Uint8Array(32).fill(7) };
          }
          return {};
        }) as never,
      },
    });

    const made = await service.create({ id: "team-1", slug: "a-lab" });
    expect(made).toEqual({
      keyId: "arn:aws:kms:us-east-1:123456789012:key/k1",
      wrappedDataKey: Buffer.from([1, 2, 3]).toString("base64"),
    });
    expect(asked.map(({ name }) => name)).toEqual([
      "CreateKeyCommand",
      "CreateAliasCommand",
      "GenerateDataKeyCommand",
    ]);
    expect(asked[0]?.input.Tags).toEqual([
      { TagKey: "truman-stage", TagValue: "truman3-test" },
      { TagKey: "truman-team", TagValue: "team-1" },
    ]);
    expect(asked[1]?.input.AliasName).toBe("alias/truman3-test-lab-team-1");

    expect(await service.unwrap(made.keyId, made.wrappedDataKey)).toEqual(Buffer.alloc(32, 7));
  });

  it("needs to know this server's own role", () => {
    expect(() => kmsKeyService({ region: "us-east-1", stage: "s", mayUse: [] })).toThrow(
      /LAB_KEY_ROLES/,
    );
  });
});
