import { createRandom, shuffled } from "./random.ts";

export interface WeightedArm {
  key: string;
  weight: number;
}

/** The chance of being assigned to an arm, overall. */
export function armProbability(arms: readonly WeightedArm[], key: string): number {
  const total = arms.reduce((sum, arm) => sum + arm.weight, 0);
  const arm = arms.find((candidate) => candidate.key === key);
  return (arm?.weight ?? 0) / total;
}

/** Picks an arm by weight. `value` is a random number from 0 up to 1. */
export function pickUniformArm(arms: readonly WeightedArm[], value: number): string {
  const total = arms.reduce((sum, arm) => sum + arm.weight, 0);
  let remaining = value * total;
  for (const arm of arms) {
    remaining -= arm.weight;
    if (remaining < 0) {
      return arm.key;
    }
  }
  throw new Error("There are no arms to pick from.");
}

export interface BlockedAssignment {
  arm: string;
  /** Which block this is, counting from 0. */
  block: number;
  /** The position within the block, counting from 0. */
  positionInBlock: number;
}

/**
 * Works out the arm for a position in a version's sequence of participants. Each block contains
 * every arm in proportion to its weight, in shuffled order. Given the seed, the whole sequence can
 * be reproduced, so it doesn't need to be stored.
 */
export function blockedArm(
  arms: readonly WeightedArm[],
  blockSize: number,
  seed: number,
  position: number,
): BlockedAssignment {
  const total = arms.reduce((sum, arm) => sum + arm.weight, 0);
  if (blockSize % total !== 0) {
    throw new Error(`A block of ${blockSize} can't be balanced across a total weight of ${total}.`);
  }

  const copies = blockSize / total;
  const contents = arms.flatMap((arm) => Array<string>(arm.weight * copies).fill(arm.key));

  const block = Math.floor(position / blockSize);
  const positionInBlock = position % blockSize;
  const order = shuffled(contents, createRandom(seed + block));

  return { arm: order[positionInBlock] as string, block, positionInBlock };
}
