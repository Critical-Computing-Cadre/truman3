import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  length: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const COST = 2 ** 15;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 32;
const MAX_MEMORY = 128 * COST * BLOCK_SIZE * 2;

/** Hashes with scrypt. The settings are stored with the hash, so they can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELISM,
    maxmem: MAX_MEMORY,
  });
  return ["scrypt", COST, BLOCK_SIZE, PARALLELISM, salt.toString("hex"), key.toString("hex")].join(
    "$",
  );
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, cost, blockSize, parallelism, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !key) {
    return false;
  }
  const expected = Buffer.from(key, "hex");
  const actual = await derive(password, Buffer.from(salt, "hex"), expected.length, {
    N: Number(cost),
    r: Number(blockSize),
    p: Number(parallelism),
    maxmem: MAX_MEMORY,
  });
  return timingSafeEqual(actual, expected);
}

/** A readable password to give someone, since accounts are created for them by command. */
export function generatePassword(): string {
  return randomBytes(18).toString("base64url");
}
