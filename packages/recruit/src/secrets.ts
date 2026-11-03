import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;

/** Reads the server's secret key, which is 32 random bytes in base64. Returns null if it's unusable. */
export function parseSecretKey(value: string | undefined): Buffer | null {
  if (!value) {
    return null;
  }
  const key = Buffer.from(value, "base64");
  return key.length === KEY_BYTES ? key : null;
}

/** Encrypts a secret for storing. A copy of the database alone can't be used to read it. */
export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), body]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

/** Throws if the key is wrong or the stored value has been changed. */
export function decryptSecret(stored: string, key: Buffer): string {
  const [version, iv, tag, body] = stored.split(".");
  if (version !== VERSION || !iv || !tag || body === undefined) {
    throw new Error("This isn't a stored secret.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(body, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
