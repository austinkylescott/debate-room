// The Lineup: the ordered Rounds a Room will run, and the edits the Host can
// make to it. Pure and dependency-free like the rest of the Room module; the
// Room (./room.ts) decides who may edit and when, this module decides what a
// valid edit is.

export type Format = "spectrum" | "middle-ground" | "surrounded";

export const FORMATS: readonly Format[] = ["spectrum", "middle-ground", "surrounded"];

export const FORMAT_NAMES: Record<Format, string> = {
  spectrum: "Spectrum",
  "middle-ground": "Middle Ground",
  surrounded: "Surrounded",
};

/** A Round's Format together with the setup that Format needs. */
export type RoundSetup =
  | { format: "spectrum" }
  | { format: "middle-ground"; sides: [string, string] }
  | {
      format: "surrounded";
      /** The Center's person id, or null to let a volunteer take the Center. */
      centerId: string | null;
      /** How long each exchange with a Challenger lasts. */
      exchangeSeconds: number;
    };

export interface Prompt {
  id: string;
  text: string;
  /** Hidden in the Preview until it is played. */
  surprise: boolean;
}

/** A Prompt as the Host sends it, before the Room gives it an id. */
export interface NewPrompt {
  text: string;
  surprise: boolean;
}

export interface Round {
  id: string;
  setup: RoundSetup;
  prompts: Prompt[];
}

/**
 * A Round as the Preview shows it: Format, Sides and Prompts, with no person ids
 * and Surprise Prompts reduced to placeholders.
 */
export interface PreviewRound {
  id: string;
  setup: PreviewSetup;
  prompts: PreviewPrompt[];
}

export type PreviewSetup =
  | { format: "spectrum" }
  | { format: "middle-ground"; sides: [string, string] }
  | { format: "surrounded" };

/** A Surprise Prompt carries no text, so it never reaches Preview viewers. */
export type PreviewPrompt = { id: string; text: string } | { id: string; surprise: true };

export interface Lineup {
  rounds: Round[];
  /** Source of Round and Prompt ids, so an id is never reused within a Room. */
  nextId: number;
}

export type LineupIntent =
  | { type: "add-round"; setup: RoundSetup; prompts: NewPrompt[] }
  /** The single-Format shortcut: replaces the whole Lineup with one Round. */
  | { type: "plan-single-round"; setup: RoundSetup; prompts: NewPrompt[] }
  | { type: "remove-round"; roundId: string }
  | { type: "move-round"; roundId: string; toIndex: number }
  | { type: "set-round-setup"; roundId: string; setup: RoundSetup }
  | { type: "add-prompts"; roundId: string; prompts: NewPrompt[] }
  | { type: "edit-prompt"; roundId: string; promptId: string; text: string; surprise: boolean }
  | { type: "remove-prompt"; roundId: string; promptId: string }
  | { type: "move-prompt"; roundId: string; promptId: string; toIndex: number };

export type LineupRejectionCode =
  | "lineup-full"
  | "round-not-found"
  | "prompt-not-found"
  | "prompt-invalid"
  | "position-invalid"
  | "setup-invalid";

export interface LineupRejection {
  code: LineupRejectionCode;
  message: string;
}

/** What the Lineup needs to know about the Room to check an edit. */
export interface LineupContext {
  /** Everyone who could be picked as a Surrounded Center. */
  personIds: string[];
}

export const MAX_ROUNDS = 20;
export const MAX_PROMPTS_PER_ROUND = 30;
export const PROMPT_MAX_LENGTH = 200;
export const SIDE_MAX_LENGTH = 30;
export const MIN_EXCHANGE_SECONDS = 15;
export const MAX_EXCHANGE_SECONDS = 600;
export const DEFAULT_EXCHANGE_SECONDS = 120;

export function emptyLineup(): Lineup {
  return { rounds: [], nextId: 1 };
}

/** A ready-to-edit setup for a Format, for when the Host first picks it. */
export function defaultSetup(format: Format, sides?: [string, string]): RoundSetup {
  switch (format) {
    case "spectrum":
      return { format };
    case "middle-ground":
      return { format, sides: sides ?? ["Side A", "Side B"] };
    case "surrounded":
      return { format, centerId: null, exchangeSeconds: DEFAULT_EXCHANGE_SECONDS };
  }
}

const LINEUP_INTENT_TYPES: ReadonlySet<string> = new Set<LineupIntent["type"]>([
  "add-round",
  "plan-single-round",
  "remove-round",
  "move-round",
  "set-round-setup",
  "add-prompts",
  "edit-prompt",
  "remove-prompt",
  "move-prompt",
]);

export function isLineupIntent(intent: { type: string }): intent is LineupIntent {
  return LINEUP_INTENT_TYPES.has(intent.type);
}

export function editLineup(
  lineup: Lineup,
  intent: LineupIntent,
  context: LineupContext,
): { lineup: Lineup } | { rejection: LineupRejection } {
  try {
    return { lineup: applyEdit(lineup, intent, context) };
  } catch (error) {
    if (error instanceof Refusal) return { rejection: error.rejection };
    throw error;
  }
}

/** The read-only Preview of a Lineup, for people who can't see the Lineup itself. */
export function previewLineup(lineup: Lineup): PreviewRound[] {
  return lineup.rounds.map((round) => ({
    id: round.id,
    setup: previewSetup(round.setup),
    prompts: round.prompts.map((p) =>
      p.surprise ? { id: p.id, surprise: true } : { id: p.id, text: p.text },
    ),
  }));
}

function previewSetup(setup: RoundSetup): PreviewSetup {
  switch (setup.format) {
    case "spectrum":
    case "surrounded":
      return { format: setup.format };
    case "middle-ground":
      return { format: "middle-ground", sides: setup.sides };
  }
}

/** Drops a person who left the Room from every Round that refers to them. */
export function forgetPerson(lineup: Lineup, personId: string): Lineup {
  const isCenter = (round: Round) =>
    round.setup.format === "surrounded" && round.setup.centerId === personId;
  if (!lineup.rounds.some(isCenter)) return lineup;
  return {
    ...lineup,
    rounds: lineup.rounds.map((round) =>
      isCenter(round) ? { ...round, setup: { ...round.setup, centerId: null } } : round,
    ),
  };
}

function applyEdit(lineup: Lineup, intent: LineupIntent, context: LineupContext): Lineup {
  switch (intent.type) {
    case "add-round": {
      if (lineup.rounds.length >= MAX_ROUNDS) {
        refuse("lineup-full", `A Lineup can have up to ${MAX_ROUNDS} Rounds.`);
      }
      return appendRound(lineup, intent.setup, intent.prompts, context);
    }
    case "plan-single-round":
      return appendRound({ ...lineup, rounds: [] }, intent.setup, intent.prompts, context);
    case "remove-round":
      findRound(lineup, intent.roundId);
      return { ...lineup, rounds: lineup.rounds.filter((r) => r.id !== intent.roundId) };
    case "move-round":
      return {
        ...lineup,
        rounds: moveItem(lineup.rounds, findRound(lineup, intent.roundId), intent.toIndex),
      };
    case "set-round-setup": {
      const setup = checkSetup(intent.setup, context);
      return updateRound(lineup, intent.roundId, (round) => ({ ...round, setup }));
    }
    case "add-prompts": {
      const round = findRound(lineup, intent.roundId);
      if (round.prompts.length + intent.prompts.length > MAX_PROMPTS_PER_ROUND) {
        refuse("lineup-full", `A Round can have up to ${MAX_PROMPTS_PER_ROUND} Prompts.`);
      }
      const added = withIds(lineup, intent.prompts);
      return replaceRound(added.lineup, {
        ...round,
        prompts: [...round.prompts, ...added.prompts],
      });
    }
    case "edit-prompt": {
      const text = checkPromptText(intent.text);
      return updatePrompt(lineup, intent.roundId, intent.promptId, (prompt) => ({
        ...prompt,
        text,
        surprise: intent.surprise,
      }));
    }
    case "remove-prompt":
      return updateRound(lineup, intent.roundId, (round) => {
        findPrompt(round, intent.promptId);
        return { ...round, prompts: round.prompts.filter((p) => p.id !== intent.promptId) };
      });
    case "move-prompt":
      return updateRound(lineup, intent.roundId, (round) => ({
        ...round,
        prompts: moveItem(round.prompts, findPrompt(round, intent.promptId), intent.toIndex),
      }));
  }
}

function appendRound(
  lineup: Lineup,
  rawSetup: RoundSetup,
  newPrompts: NewPrompt[],
  context: LineupContext,
): Lineup {
  const setup = checkSetup(rawSetup, context);
  if (newPrompts.length > MAX_PROMPTS_PER_ROUND) {
    refuse("lineup-full", `A Round can have up to ${MAX_PROMPTS_PER_ROUND} Prompts.`);
  }
  const id = `r${lineup.nextId}`;
  const added = withIds({ ...lineup, nextId: lineup.nextId + 1 }, newPrompts);
  return {
    rounds: [...added.lineup.rounds, { id, setup, prompts: added.prompts }],
    nextId: added.lineup.nextId,
  };
}

/** Checks and gives ids to new Prompts, advancing the Lineup's id counter. */
function withIds(lineup: Lineup, newPrompts: NewPrompt[]): { lineup: Lineup; prompts: Prompt[] } {
  const prompts = newPrompts.map((p, i) => ({
    id: `pr${lineup.nextId + i}`,
    text: checkPromptText(p.text),
    surprise: p.surprise,
  }));
  return { lineup: { ...lineup, nextId: lineup.nextId + prompts.length }, prompts };
}

function updateRound(lineup: Lineup, roundId: string, update: (round: Round) => Round): Lineup {
  return replaceRound(lineup, update(findRound(lineup, roundId)));
}

function replaceRound(lineup: Lineup, round: Round): Lineup {
  return { ...lineup, rounds: lineup.rounds.map((r) => (r.id === round.id ? round : r)) };
}

function updatePrompt(
  lineup: Lineup,
  roundId: string,
  promptId: string,
  update: (prompt: Prompt) => Prompt,
): Lineup {
  return updateRound(lineup, roundId, (round) => {
    const updated = update(findPrompt(round, promptId));
    return { ...round, prompts: round.prompts.map((p) => (p.id === promptId ? updated : p)) };
  });
}

function moveItem<T extends { id: string }>(items: T[], item: T, toIndex: number): T[] {
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= items.length) {
    refuse("position-invalid", "That position isn't in the list.");
  }
  const rest = items.filter((i) => i.id !== item.id);
  return [...rest.slice(0, toIndex), item, ...rest.slice(toIndex)];
}

function findRound(lineup: Lineup, roundId: string): Round {
  const round = lineup.rounds.find((r) => r.id === roundId);
  if (!round) refuse("round-not-found", "That Round isn't in the Lineup any more.");
  return round;
}

function findPrompt(round: Round, promptId: string): Prompt {
  const prompt = round.prompts.find((p) => p.id === promptId);
  if (!prompt) refuse("prompt-not-found", "That Prompt isn't in the Round any more.");
  return prompt;
}

function checkSetup(setup: RoundSetup, context: LineupContext): RoundSetup {
  switch (setup.format) {
    case "spectrum":
      return { format: "spectrum" };
    case "middle-ground": {
      const sides = setup.sides.map((s) => normalizeText(s, SIDE_MAX_LENGTH));
      const [a, b] = sides;
      if (a === null || b === null) {
        refuse("setup-invalid", `Each Side needs a name of 1 to ${SIDE_MAX_LENGTH} characters.`);
      }
      if (a.toLocaleLowerCase() === b.toLocaleLowerCase()) {
        refuse("setup-invalid", "The two Sides need different names.");
      }
      return { format: "middle-ground", sides: [a, b] };
    }
    case "surrounded": {
      const { centerId, exchangeSeconds } = setup;
      if (centerId !== null && !context.personIds.includes(centerId)) {
        refuse("setup-invalid", "That person isn't in the Room, so they can't be the Center.");
      }
      if (
        !Number.isInteger(exchangeSeconds) ||
        exchangeSeconds < MIN_EXCHANGE_SECONDS ||
        exchangeSeconds > MAX_EXCHANGE_SECONDS
      ) {
        refuse(
          "setup-invalid",
          `The exchange timer needs a whole number of seconds from ${MIN_EXCHANGE_SECONDS} to ${MAX_EXCHANGE_SECONDS}.`,
        );
      }
      return { format: "surrounded", centerId, exchangeSeconds };
    }
  }
}

function checkPromptText(raw: string): string {
  const text = normalizeText(raw, PROMPT_MAX_LENGTH);
  if (text === null) {
    refuse("prompt-invalid", `A Prompt needs 1 to ${PROMPT_MAX_LENGTH} characters.`);
  }
  return text;
}

/** Trims and collapses whitespace. Returns null if the result is empty or too long. */
function normalizeText(raw: string, maxLength: number): string | null {
  const text = raw.trim().replace(/\s+/g, " ");
  if (text.length === 0 || text.length > maxLength) return null;
  return text;
}

class Refusal extends Error {
  readonly rejection: LineupRejection;

  constructor(rejection: LineupRejection) {
    super(rejection.message);
    this.rejection = rejection;
  }
}

function refuse(code: LineupRejectionCode, message: string): never {
  throw new Refusal({ code, message });
}

// --- Parsing intents received over the wire ---

/** Checks the shape of a Lineup intent. Returns null if it isn't one. */
export function parseLineupIntent(value: Record<string, unknown>): LineupIntent | null {
  const { roundId, promptId, toIndex } = value;
  switch (value.type) {
    case "add-round":
    case "plan-single-round": {
      const setup = parseSetup(value.setup);
      const prompts = parseNewPrompts(value.prompts);
      return setup && prompts ? { type: value.type, setup, prompts } : null;
    }
    case "remove-round":
      return typeof roundId === "string" ? { type: "remove-round", roundId } : null;
    case "move-round":
      return typeof roundId === "string" && typeof toIndex === "number"
        ? { type: "move-round", roundId, toIndex }
        : null;
    case "set-round-setup": {
      const setup = parseSetup(value.setup);
      return typeof roundId === "string" && setup
        ? { type: "set-round-setup", roundId, setup }
        : null;
    }
    case "add-prompts": {
      const prompts = parseNewPrompts(value.prompts);
      return typeof roundId === "string" && prompts
        ? { type: "add-prompts", roundId, prompts }
        : null;
    }
    case "edit-prompt":
      return typeof roundId === "string" &&
        typeof promptId === "string" &&
        typeof value.text === "string" &&
        typeof value.surprise === "boolean"
        ? { type: "edit-prompt", roundId, promptId, text: value.text, surprise: value.surprise }
        : null;
    case "remove-prompt":
      return typeof roundId === "string" && typeof promptId === "string"
        ? { type: "remove-prompt", roundId, promptId }
        : null;
    case "move-prompt":
      return typeof roundId === "string" &&
        typeof promptId === "string" &&
        typeof toIndex === "number"
        ? { type: "move-prompt", roundId, promptId, toIndex }
        : null;
    default:
      return null;
  }
}

function parseSetup(raw: unknown): RoundSetup | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  switch (value.format) {
    case "spectrum":
      return { format: "spectrum" };
    case "middle-ground": {
      const { sides } = value;
      return Array.isArray(sides) &&
        sides.length === 2 &&
        typeof sides[0] === "string" &&
        typeof sides[1] === "string"
        ? { format: "middle-ground", sides: [sides[0], sides[1]] }
        : null;
    }
    case "surrounded": {
      const { centerId, exchangeSeconds } = value;
      return (centerId === null || typeof centerId === "string") &&
        typeof exchangeSeconds === "number"
        ? { format: "surrounded", centerId, exchangeSeconds }
        : null;
    }
    default:
      return null;
  }
}

function parseNewPrompts(raw: unknown): NewPrompt[] | null {
  if (!Array.isArray(raw)) return null;
  const prompts: NewPrompt[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const { text, surprise } = item as Record<string, unknown>;
    if (typeof text !== "string" || typeof surprise !== "boolean") return null;
    prompts.push({ text, surprise });
  }
  return prompts;
}
