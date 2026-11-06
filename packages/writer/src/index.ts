import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

/**
 * The gateway Christof writes through: a model writes a line for someone in the cast, and a second
 * call checks it against the study's limits before it can be posted. Claude is the first model
 * behind it, and others can be added as another `Writer`. See ADR 52.
 */

/** What a model is asked to write, and within what. */
export interface WriteRequest {
  model: string;
  /** Who they are and how to write, which is the same for every line in a study. */
  system: string;
  /** What they see, and what the beat asks for. */
  prompt: string;
  maxLength: number;
}

export interface Written {
  text: string;
  /** The model that wrote it, which differs from the one asked for if a fallback ran. */
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface Checked {
  allowed: boolean;
  /** Why not, in plain words, when it isn't allowed. */
  reason: string;
  model: string;
  costUsd: number;
}

export interface Writer {
  write(request: WriteRequest): Promise<Written>;
  /** Whether this line can be posted, given the limits it must stay within. */
  check(text: string, limits: readonly string[], model: string): Promise<Checked>;
}

/** The model declined, or said nothing usable, so the beat's fallback line is used instead. */
export class NothingWritten extends Error {}

/**
 * US dollars per million tokens, in and out, from Anthropic's price list. A model not listed is
 * priced as the most expensive one, so a budget is never overrun by a missing entry.
 */
const PRICES: Record<string, [number, number]> = {
  "claude-fable-5-1": [10, 50],
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-opus-4-8": [5, 25],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};
const MOST_EXPENSIVE: [number, number] = [10, 50];

export function costOf(model: string, inputTokens: number, outputTokens: number) {
  const [inPrice, outPrice] = PRICES[model] ?? MOST_EXPENSIVE;
  return (inputTokens * inPrice + outputTokens * outPrice) / 1_000_000;
}

/** Limits that hold in every study, whatever its own red lines say. */
export const ALWAYS_OFF_LIMITS = [
  "Slurs, or hate aimed at anyone for their race, ethnicity, religion, gender, sexuality, disability, or nationality",
  "Sexual content",
  "Threats of violence, or encouraging anyone to hurt themselves",
  "Real people's names or private information, such as addresses or phone numbers",
  "Instructions for anything dangerous or illegal",
  "Saying it's an AI, a study, or a simulation, or anything other than a post or comment on the platform",
];

const CHECK_SYSTEM = `You check one line written for a character in a social media research simulation, before it's posted. The study's script decides what happens, and some studies deliberately include rudeness or conflict, such as studies of online harassment, so don't block a line for being unkind or wrong. Block it only if it crosses one of the limits you're given. Answer with whether it's allowed and, if not, which limit it crosses, in a short sentence.`;

const verdictSchema = z.object({ allowed: z.boolean(), reason: z.string() });

/** Trims what a model wrote down to the line itself, within the length allowed. */
export function cleanLine(text: string, maxLength: number) {
  let line = text.trim();
  if (/^["“].*["”]$/s.test(line)) {
    line = line.slice(1, -1).trim();
  }
  return line.length > maxLength ? `${line.slice(0, maxLength - 1).trimEnd()}…` : line;
}

/** Writes through the Anthropic API, with a server-side fallback if a model declines. */
export function anthropicWriter(apiKey: string): Writer {
  const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 2 });
  return {
    async write({ model, system, prompt, maxLength }) {
      const response = await client.beta.messages.create({
        model,
        max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low" },
        system,
        messages: [{ role: "user", content: prompt }],
      });
      if (response.stop_reason === "refusal") {
        throw new NothingWritten("The model declined to write this.");
      }
      const text = response.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("")
        .trim();
      if (!text) {
        throw new NothingWritten("The model wrote nothing.");
      }
      const { input_tokens, output_tokens } = response.usage;
      return {
        text: cleanLine(text, maxLength),
        model: response.model,
        inputTokens: input_tokens,
        outputTokens: output_tokens,
        costUsd: costOf(response.model, input_tokens, output_tokens),
      };
    },
    async check(text, limits, model) {
      const response = await client.beta.messages.parse({
        model,
        max_tokens: 2000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: betaZodOutputFormat(verdictSchema) },
        system: CHECK_SYSTEM,
        messages: [
          {
            role: "user",
            content: `Limits:\n${limits.map((limit) => `- ${limit}`).join("\n")}\n\nThe line:\n${text}`,
          },
        ],
      });
      const costUsd = costOf(
        response.model,
        response.usage.input_tokens,
        response.usage.output_tokens,
      );
      // Anything that isn't a clear yes is a no, so a line is only posted when it was checked.
      const verdict = response.stop_reason === "refusal" ? null : response.parsed_output;
      return verdict
        ? { allowed: verdict.allowed, reason: verdict.reason, model: response.model, costUsd }
        : { allowed: false, reason: "The check couldn't decide.", model: response.model, costUsd };
    },
  };
}

/**
 * A writer for tests and for trying a study without a key: it writes from what it's given, costs
 * nothing, and blocks only lines containing "BLOCK". It never calls a model.
 */
export function standInWriter(
  write: (request: WriteRequest) => string = () => "A stand-in line",
): Writer & {
  calls: WriteRequest[];
} {
  const calls: WriteRequest[] = [];
  return {
    calls,
    async write(request) {
      calls.push(request);
      return {
        text: cleanLine(write(request), request.maxLength),
        model: "stand-in",
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0.01,
      };
    },
    async check(text) {
      return text.includes("BLOCK")
        ? { allowed: false, reason: "It crosses a limit.", model: "stand-in", costUsd: 0 }
        : { allowed: true, reason: "", model: "stand-in", costUsd: 0 };
    },
  };
}
