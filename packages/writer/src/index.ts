import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat, betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
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

/** Picking among rehearsed lines: the one that fits, or, if allowed, a new line instead. */
export interface ChooseRequest extends WriteRequest {
  lines: readonly string[];
  /** Whether it may write its own line when none fits. */
  allowNew: boolean;
}

export interface Chosen {
  /** Which rehearsed line, from 0, or null for a new one. */
  choice: number | null;
  text: string;
  model: string;
  costUsd: number;
}

export interface Rehearsed {
  lines: string[];
  model: string;
  costUsd: number;
}

/** What a simulated participant can do at one look at their feed. */
export const ACTS = [
  "nothing",
  "like",
  "upvote",
  "downvote",
  "comment",
  "repost",
  "follow",
  "post",
  "flag",
] as const;

/**
 * Text from structured output, without a stray closing brace. Models sometimes end the last field
 * of the object inside the string, as in "Salt the water.}", and nobody writes that on purpose.
 */
export function withoutStrayBrace(text: string): string {
  return text.includes("{") ? text : text.replace(/\s*\}+\s*$/, "");
}

/** A simulated participant's turn: who they are and what they see, numbered. */
export interface ActRequest {
  model: string;
  system: string;
  prompt: string;
}

/** What they chose, by the number of what they chose it on, in their own words. */
export interface Acted {
  action: (typeof ACTS)[number];
  /** The number of the post or comment it's on, or whose author to follow. Null for none. */
  item: number | null;
  /** What they write, for a post or comment. */
  text: string;
  /** Why, in their own voice, for the researcher reading the transcript. */
  why: string;
  model: string;
  costUsd: number;
}

/** A tool an agent can use, with what it takes and what it does. ADR 65. */
export interface AgentToolSpec {
  name: string;
  description: string;
  input: z.ZodRawShape;
  run: (input: unknown) => Promise<string>;
}

/** One thing an agent did, for the researcher to read: a tool it used, or what it said. */
export interface AgentStep {
  tool?: string;
  input?: unknown;
  /** What the tool answered, shortened, or what the agent said. */
  text: string;
  error?: boolean;
}

export interface AgentRequest {
  model: string;
  system: string;
  prompt: string;
  tools: AgentToolSpec[];
  /** The most it may spend, in US dollars. It stops after the step that reaches this. */
  budgetUsd: number;
  /** The most model calls it may make. */
  maxSteps: number;
  /** Told about each step as it happens, so progress can be shown. */
  onStep?: (step: AgentStep, spentUsd: number) => void | Promise<void>;
}

export interface AgentRun {
  /** What it said at the end: what it did, and what it recommends. */
  summary: string;
  model: string;
  costUsd: number;
  /** Why it stopped: it finished, reached its budget or step limit, or declined. */
  stopped: "done" | "budget" | "steps" | "refused";
}

export interface Writer {
  write(request: WriteRequest): Promise<Written>;
  /** Whether this line can be posted, given the limits it must stay within. */
  check(text: string, limits: readonly string[], model: string): Promise<Checked>;
  choose(request: ChooseRequest): Promise<Chosen>;
  /** Several different lines for a beat, written ahead of time for a researcher to review. */
  rehearse(request: WriteRequest & { count: number }): Promise<Rehearsed>;
  /** A simulated participant's next move. See ADR 60. */
  act(request: ActRequest): Promise<Acted>;
  /** An agent working with tools, such as drafting a study from a brief. See ADR 65. */
  runAgent(request: AgentRequest): Promise<AgentRun>;
}

/** What a tool answered, short enough to keep in a run's log. */
const forLog = (text: string) => (text.length > 600 ? `${text.slice(0, 600)}…` : text);

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
const choiceSchema = z.object({
  /** Which line fits, from 1, or 0 for none. */
  line: z.number().int(),
  /** A new line, only when none fits and writing one is allowed. */
  newLine: z.string(),
});
const rehearsalSchema = z.object({ lines: z.array(z.string()) });
const actSchema = z.object({
  why: z.string(),
  action: z.enum(ACTS),
  item: z.number().int().nullable(),
  text: z.string(),
});

/** The line to use from a choice, or null if the choice can't be used. */
export function lineFromChoice(
  { line, newLine }: { line: number; newLine: string },
  lines: readonly string[],
  allowNew: boolean,
  maxLength: number,
): { choice: number | null; text: string } | null {
  if (line >= 1 && line <= lines.length) {
    return { choice: line - 1, text: lines[line - 1] as string };
  }
  return allowNew && newLine.trim() ? { choice: null, text: cleanLine(newLine, maxLength) } : null;
}

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
    async choose({ model, system, prompt, maxLength, lines, allowNew }) {
      const response = await client.beta.messages.parse({
        model,
        max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: betaZodOutputFormat(choiceSchema) },
        system,
        messages: [
          {
            role: "user",
            content: `${prompt}\n\nLines rehearsed for this moment:\n${lines.map((line, index) => `${index + 1}. ${line}`).join("\n")}\n\nGive the number of the line that fits what's happening best. ${
              allowNew
                ? "If none of them fits, give 0, and write your own line in newLine."
                : "One of them has to be used, so pick the closest. Leave newLine empty."
            }`,
          },
        ],
      });
      const costUsd = costOf(
        response.model,
        response.usage.input_tokens,
        response.usage.output_tokens,
      );
      const picked =
        response.stop_reason === "refusal" || !response.parsed_output
          ? null
          : lineFromChoice(response.parsed_output, lines, allowNew, maxLength);
      if (!picked) {
        throw new NothingWritten("The model couldn't choose a line.");
      }
      return { ...picked, model: response.model, costUsd };
    },
    async rehearse({ model, system, prompt, maxLength, count }) {
      const response = await client.beta.messages.parse({
        model,
        max_tokens: 8000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium", format: betaZodOutputFormat(rehearsalSchema) },
        system,
        messages: [
          {
            role: "user",
            content: `${prompt}\n\nThis is a rehearsal, before anyone takes part. Write ${count} different versions of this line. What the participant does can't be known yet, so each should work for the different ways they might act, and they should differ from each other in wording and tone.`,
          },
        ],
      });
      if (response.stop_reason === "refusal" || !response.parsed_output) {
        throw new NothingWritten("The model declined to rehearse this.");
      }
      return {
        lines: response.parsed_output.lines
          .map((line) => cleanLine(line, maxLength))
          .filter(Boolean)
          .slice(0, count),
        model: response.model,
        costUsd: costOf(response.model, response.usage.input_tokens, response.usage.output_tokens),
      };
    },
    async act({ model, system, prompt }) {
      const response = await client.beta.messages.parse({
        model,
        max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: betaZodOutputFormat(actSchema) },
        system,
        messages: [{ role: "user", content: prompt }],
      });
      const costUsd = costOf(
        response.model,
        response.usage.input_tokens,
        response.usage.output_tokens,
      );
      // Declining to play along is doing nothing this time, and it still costs what it cost.
      const acted =
        response.stop_reason === "refusal" || !response.parsed_output
          ? { action: "nothing" as const, item: null, text: "", why: "(The model declined.)" }
          : {
              ...response.parsed_output,
              text: withoutStrayBrace(response.parsed_output.text),
              why: withoutStrayBrace(response.parsed_output.why),
            };
      return { ...acted, model: response.model, costUsd };
    },
    async runAgent({ model, system, prompt, tools, budgetUsd, maxSteps, onStep }) {
      let spentUsd = 0;
      const runner = client.beta.messages.toolRunner({
        model,
        max_tokens: 16_000,
        thinking: { type: "adaptive" },
        // The guide and instructions are the same on every call, so they're cached.
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        max_iterations: maxSteps,
        tools: tools.map((tool) =>
          betaZodTool({
            name: tool.name,
            description: tool.description,
            inputSchema: z.object(tool.input),
            run: async (input) => {
              try {
                const text = await tool.run(input);
                await onStep?.({ tool: tool.name, input, text: forLog(text) }, spentUsd);
                return text;
              } catch (error) {
                const text = error instanceof Error ? error.message : String(error);
                await onStep?.(
                  { tool: tool.name, input, text: forLog(text), error: true },
                  spentUsd,
                );
                return `That didn't work: ${text}`;
              }
            },
          }),
        ),
        messages: [{ role: "user", content: prompt }],
      });
      let last: Anthropic.Beta.BetaMessage | null = null;
      let stopped: AgentRun["stopped"] = "done";
      let steps = 0;
      for await (const message of runner) {
        last = message;
        steps++;
        const { usage } = message;
        // Cached input costs a tenth to read, and a quarter more to write.
        spentUsd += costOf(
          message.model,
          usage.input_tokens +
            (usage.cache_creation_input_tokens ?? 0) * 1.25 +
            (usage.cache_read_input_tokens ?? 0) * 0.1,
          usage.output_tokens,
        );
        if (message.stop_reason === "refusal") {
          stopped = "refused";
          break;
        }
        if (spentUsd >= budgetUsd) {
          stopped = message.stop_reason === "tool_use" ? "budget" : "done";
          break;
        }
      }
      if (stopped === "done" && last?.stop_reason === "tool_use" && steps >= maxSteps) {
        stopped = "steps";
      }
      const summary = (last?.content ?? [])
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("\n")
        .trim();
      return { summary, model: last?.model ?? model, costUsd: spentUsd, stopped };
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
    // Picks the first rehearsed line that shares a word with what's happening, or writes its own.
    async choose(request) {
      calls.push(request);
      const words = new Set(request.prompt.toLowerCase().match(/[a-z]{4,}/g) ?? []);
      const fits = request.lines.findIndex((line) =>
        (line.toLowerCase().match(/[a-z]{4,}/g) ?? []).some((word) => words.has(word)),
      );
      const picked = lineFromChoice(
        { line: fits + 1, newLine: write(request) },
        request.lines,
        request.allowNew,
        request.maxLength,
      ) ?? { choice: 0, text: request.lines[0] as string };
      return { ...picked, model: "stand-in", costUsd: 0.01 };
    },
    async rehearse(request) {
      calls.push(request);
      return {
        lines: Array.from({ length: request.count }, (_, index) => `Rehearsed line ${index + 1}`),
        model: "stand-in",
        costUsd: 0.02,
      };
    },
    // Comments on the first thing it sees, then does nothing.
    async act(request) {
      calls.push({ ...request, maxLength: 0 });
      const first = !calls.slice(0, -1).some((call) => call.system === request.system);
      return first && request.prompt.includes("[1]")
        ? {
            action: "comment",
            item: 1,
            text: "A stand-in comment",
            why: "It was the first thing I saw.",
            model: "stand-in",
            costUsd: 0.01,
          }
        : {
            action: "nothing",
            item: null,
            text: "",
            why: "Nothing grabbed me.",
            model: "stand-in",
            costUsd: 0.01,
          };
    },
    // Does nothing, so trying a study without a key never changes it.
    async runAgent() {
      return {
        summary: "A stand-in agent doesn't do anything. Set ANTHROPIC_API_KEY to use one.",
        model: "stand-in",
        costUsd: 0,
        stopped: "done" as const,
      };
    },
  };
}
