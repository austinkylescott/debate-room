// The Lineup: the ordered Rounds a Room will run, each a Format, its setup and
// its Prompts. Pure edit functions over the Lineup, used by the Room module.

import { tidyText } from "./text";

export type Format = "spectrum" | "middle-ground" | "surrounded";

export type CenterChoice = { mode: "volunteer" } | { mode: "chosen"; personId: string };

export type RoundSetup =
  | { format: "spectrum" }
  | { format: "middle-ground"; sides: [string, string] }
  | { format: "surrounded"; center: CenterChoice; exchangeSeconds: number };

export interface Prompt {
  id: string;
  text: string;
  /** Hidden in the Preview until it is played. */
  surprise: boolean;
}

export interface NewPrompt {
  text: string;
  surprise: boolean;
}

export interface Round {
  id: string;
  setup: RoundSetup;
  prompts: Prompt[];
}

export interface Lineup {
  rounds: Round[];
  nextRoundNumber: number;
  nextPromptNumber: number;
}

/** Intents that edit the Lineup. Only the Host may send them. */
export type LineupIntent =
  | { type: "add-round"; setup: RoundSetup }
  | { type: "set-round-setup"; roundId: string; setup: RoundSetup }
  | { type: "remove-round"; roundId: string }
  | { type: "move-round"; roundId: string; toIndex: number }
  /** The single-Format shortcut: a whole night of one Format from one Pack. */
  | { type: "use-single-round"; setup: RoundSetup; prompts: NewPrompt[] }
  | { type: "add-prompts"; roundId: string; prompts: NewPrompt[] }
  | { type: "edit-prompt"; roundId: string; promptId: string; text: string; surprise: boolean }
  | { type: "remove-prompt"; roundId: string; promptId: string }
  | { type: "move-prompt"; roundId: string; promptId: string; toIndex: number };

export type LineupErrorCode = "setup-invalid" | "prompt-invalid" | "not-found";

export interface LineupError {
  code: LineupErrorCode;
  message: string;
}

/** What a Lineup edit needs to know about the Room around it. */
export interface LineupContext {
  personIds: string[];
}

export const SIDE_NAME_MAX_LENGTH = 30;
export const PROMPT_MAX_LENGTH = 200;
export const EXCHANGE_SECONDS_MIN = 15;
export const EXCHANGE_SECONDS_MAX = 600;

export const emptyLineup = (): Lineup => ({ rounds: [], nextRoundNumber: 1, nextPromptNumber: 1 });

export function editLineup(
  lineup: Lineup,
  intent: LineupIntent,
  context: LineupContext,
): { lineup: Lineup } | { error: LineupError } {
  switch (intent.type) {
    case "add-round": {
      const setup = checkSetup(intent.setup, context);
      if ("error" in setup) return setup;
      return { lineup: addRound(lineup, setup.setup) };
    }
    case "set-round-setup":
      return withRound(lineup, intent.roundId, (round) => {
        const setup = checkSetup(intent.setup, context);
        if ("error" in setup) return setup;
        return { round: { ...round, setup: setup.setup } };
      });
    case "remove-round": {
      if (!lineup.rounds.some((r) => r.id === intent.roundId)) return roundNotFound();
      return {
        lineup: { ...lineup, rounds: lineup.rounds.filter((r) => r.id !== intent.roundId) },
      };
    }
    case "move-round": {
      const round = lineup.rounds.find((r) => r.id === intent.roundId);
      if (!round) return roundNotFound();
      return { lineup: { ...lineup, rounds: moveItem(lineup.rounds, round, intent.toIndex) } };
    }
    case "use-single-round": {
      const withOneRound = editLineup(
        { ...lineup, rounds: [] },
        { type: "add-round", setup: intent.setup },
        context,
      );
      if ("error" in withOneRound) return withOneRound;
      const roundId = withOneRound.lineup.rounds[0]?.id ?? "";
      return editLineup(
        withOneRound.lineup,
        { type: "add-prompts", roundId, prompts: intent.prompts },
        context,
      );
    }
    case "add-prompts":
      return withRound(lineup, intent.roundId, (round, current) => {
        const texts = intent.prompts.map((p) => checkPromptText(p.text));
        if (texts.some((text) => text === null)) return invalidPrompt();
        const prompts = texts.map((text, i) => ({
          id: `q${current.nextPromptNumber + i}`,
          text: text ?? "",
          surprise: intent.prompts[i]?.surprise === true,
        }));
        return {
          round: { ...round, prompts: [...round.prompts, ...prompts] },
          nextPromptNumber: current.nextPromptNumber + prompts.length,
        };
      });
    case "edit-prompt":
      return withPrompt(lineup, intent.roundId, intent.promptId, (round, prompt) => {
        const text = checkPromptText(intent.text);
        if (text === null) return invalidPrompt();
        const edited = { ...prompt, text, surprise: intent.surprise };
        return {
          round: { ...round, prompts: round.prompts.map((p) => (p === prompt ? edited : p)) },
        };
      });
    case "remove-prompt":
      return withPrompt(lineup, intent.roundId, intent.promptId, (round, prompt) => ({
        round: { ...round, prompts: round.prompts.filter((p) => p !== prompt) },
      }));
    case "move-prompt":
      return withPrompt(lineup, intent.roundId, intent.promptId, (round, prompt) => ({
        round: { ...round, prompts: moveItem(round.prompts, prompt, intent.toIndex) },
      }));
  }
}

/** Moves `item` to `toIndex`, clamped to the list. */
function moveItem<T>(items: T[], item: T, toIndex: number): T[] {
  const rest = items.filter((i) => i !== item);
  const index = Math.max(0, Math.min(rest.length, Math.trunc(toIndex)));
  return [...rest.slice(0, index), item, ...rest.slice(index)];
}

function withPrompt(
  lineup: Lineup,
  roundId: string,
  promptId: string,
  edit: (round: Round, prompt: Prompt) => RoundEdit,
): { lineup: Lineup } | { error: LineupError } {
  return withRound(lineup, roundId, (round) => {
    const prompt = round.prompts.find((p) => p.id === promptId);
    if (!prompt) return notFound("That Prompt isn't in the Round any more.");
    return edit(round, prompt);
  });
}

function addRound(lineup: Lineup, setup: RoundSetup): Lineup {
  const round: Round = { id: `r${lineup.nextRoundNumber}`, setup, prompts: [] };
  return {
    ...lineup,
    rounds: [...lineup.rounds, round],
    nextRoundNumber: lineup.nextRoundNumber + 1,
  };
}

type RoundEdit = { round: Round; nextPromptNumber?: number } | { error: LineupError };

/** Applies an edit to one Round, or reports that the Round doesn't exist. */
function withRound(
  lineup: Lineup,
  roundId: string,
  edit: (round: Round, lineup: Lineup) => RoundEdit,
): { lineup: Lineup } | { error: LineupError } {
  const round = lineup.rounds.find((r) => r.id === roundId);
  if (!round) return roundNotFound();
  const result = edit(round, lineup);
  if ("error" in result) return result;
  return {
    lineup: {
      ...lineup,
      rounds: lineup.rounds.map((r) => (r.id === roundId ? result.round : r)),
      nextPromptNumber: result.nextPromptNumber ?? lineup.nextPromptNumber,
    },
  };
}

function checkSetup(
  setup: RoundSetup,
  context: LineupContext,
): { setup: RoundSetup } | { error: LineupError } {
  switch (setup.format) {
    case "spectrum":
      return { setup: { format: "spectrum" } };
    case "middle-ground": {
      const sides = setup.sides.map(tidyText);
      if (sides.some((side) => side.length === 0 || side.length > SIDE_NAME_MAX_LENGTH)) {
        return invalidSetup(`Each Side needs a name of 1 to ${SIDE_NAME_MAX_LENGTH} characters.`);
      }
      return { setup: { format: "middle-ground", sides: [sides[0], sides[1]] } };
    }
    case "surrounded": {
      const { center, exchangeSeconds } = setup;
      if (center.mode === "chosen" && !context.personIds.includes(center.personId)) {
        return invalidSetup("The Center has to be someone in the Room.");
      }
      if (
        !Number.isInteger(exchangeSeconds) ||
        exchangeSeconds < EXCHANGE_SECONDS_MIN ||
        exchangeSeconds > EXCHANGE_SECONDS_MAX
      ) {
        return invalidSetup(
          `The exchange timer has to be ${EXCHANGE_SECONDS_MIN} to ${EXCHANGE_SECONDS_MAX} seconds.`,
        );
      }
      return { setup: { format: "surrounded", center, exchangeSeconds } };
    }
  }
}

/** Tidies a Prompt's text. Returns null if the result is empty or too long. */
function checkPromptText(raw: string): string | null {
  const text = tidyText(raw);
  return text.length === 0 || text.length > PROMPT_MAX_LENGTH ? null : text;
}

function invalidSetup(message: string): { error: LineupError } {
  return { error: { code: "setup-invalid", message } };
}

function invalidPrompt(): { error: LineupError } {
  return {
    error: {
      code: "prompt-invalid",
      message: `Prompts need 1 to ${PROMPT_MAX_LENGTH} characters.`,
    },
  };
}

function roundNotFound(): { error: LineupError } {
  return notFound("That Round isn't in the Lineup any more.");
}

function notFound(message: string): { error: LineupError } {
  return { error: { code: "not-found", message } };
}

/** Checks the shape of a Lineup intent received over the wire. Returns null if it isn't one. */
export function parseLineupIntent(value: Record<string, unknown>): LineupIntent | null {
  const { roundId, promptId, toIndex } = value;
  switch (value.type) {
    case "add-round": {
      const setup = parseSetup(value.setup);
      return setup && { type: "add-round", setup };
    }
    case "set-round-setup": {
      const setup = parseSetup(value.setup);
      return setup && isString(roundId) ? { type: "set-round-setup", roundId, setup } : null;
    }
    case "remove-round":
      return isString(roundId) ? { type: "remove-round", roundId } : null;
    case "move-round":
      return isString(roundId) && isNumber(toIndex)
        ? { type: "move-round", roundId, toIndex }
        : null;
    case "use-single-round": {
      const setup = parseSetup(value.setup);
      const prompts = parseNewPrompts(value.prompts);
      return setup && prompts ? { type: "use-single-round", setup, prompts } : null;
    }
    case "add-prompts": {
      const prompts = parseNewPrompts(value.prompts);
      return prompts && isString(roundId) ? { type: "add-prompts", roundId, prompts } : null;
    }
    case "edit-prompt": {
      const { text, surprise } = value;
      return isString(roundId) && isString(promptId) && isString(text) && isBoolean(surprise)
        ? { type: "edit-prompt", roundId, promptId, text, surprise }
        : null;
    }
    case "remove-prompt":
      return isString(roundId) && isString(promptId)
        ? { type: "remove-prompt", roundId, promptId }
        : null;
    case "move-prompt":
      return isString(roundId) && isString(promptId) && isNumber(toIndex)
        ? { type: "move-prompt", roundId, promptId, toIndex }
        : null;
    default:
      return null;
  }
}

function parseSetup(raw: unknown): RoundSetup | null {
  if (!isRecord(raw)) return null;
  switch (raw.format) {
    case "spectrum":
      return { format: "spectrum" };
    case "middle-ground": {
      const { sides } = raw;
      return Array.isArray(sides) && sides.length === 2 && sides.every(isString)
        ? { format: "middle-ground", sides: [sides[0], sides[1]] }
        : null;
    }
    case "surrounded": {
      const center = parseCenter(raw.center);
      return center && isNumber(raw.exchangeSeconds)
        ? { format: "surrounded", center, exchangeSeconds: raw.exchangeSeconds }
        : null;
    }
    default:
      return null;
  }
}

function parseCenter(raw: unknown): CenterChoice | null {
  if (!isRecord(raw)) return null;
  if (raw.mode === "volunteer") return { mode: "volunteer" };
  if (raw.mode === "chosen" && isString(raw.personId)) {
    return { mode: "chosen", personId: raw.personId };
  }
  return null;
}

function parseNewPrompts(raw: unknown): NewPrompt[] | null {
  if (!Array.isArray(raw)) return null;
  const prompts = raw.map((p) =>
    isRecord(p) && isString(p.text) && isBoolean(p.surprise)
      ? { text: p.text, surprise: p.surprise }
      : null,
  );
  return prompts.every((p) => p !== null) ? prompts : null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";

export const FORMATS: Format[] = ["spectrum", "middle-ground", "surrounded"];

export const FORMAT_NAMES: Record<Format, string> = {
  spectrum: "Spectrum",
  "middle-ground": "Middle Ground",
  surrounded: "Surrounded",
};

/** The setup a new Round of a Format starts with, before the Host changes it. */
export function defaultSetup(format: Format): RoundSetup {
  switch (format) {
    case "spectrum":
      return { format: "spectrum" };
    case "middle-ground":
      return { format: "middle-ground", sides: ["Side A", "Side B"] };
    case "surrounded":
      return { format: "surrounded", center: { mode: "volunteer" }, exchangeSeconds: 60 };
  }
}
