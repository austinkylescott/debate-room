// Moods: how each Playing person feels during a Prompt, and the Mood Check-in
// when the Prompt ends. Format-independent: the Round (./round.ts) keeps one of
// these per Prompt and says who is Playing. Pure and dependency-free like the
// rest of the Room module.

/** The fixed set of Moods, in the order they're offered. */
export const MOODS = [
  { id: "happy", emoji: "😀", label: "Happy" },
  { id: "love", emoji: "❤️", label: "Love" },
  { id: "amused", emoji: "😂", label: "Amused" },
  { id: "surprised", emoji: "😮", label: "Surprised" },
  { id: "thinking", emoji: "🤔", label: "Thinking" },
  { id: "sad", emoji: "😢", label: "Sad" },
  { id: "angry", emoji: "😠", label: "Angry" },
] as const;

export type Mood = (typeof MOODS)[number]["id"];

/** How long a Mood Check-in stays open if not everyone answers. */
export const CHECK_IN_MS = 15_000;

export function isMood(value: unknown): value is Mood {
  return MOODS.some((m) => m.id === value);
}

/** The Moods of one Prompt. */
export interface PromptMoods {
  /** Each Playing person's current Mood. Anyone without one is left out. */
  current: Record<string, Mood>;
  /** The Check-in, once the Prompt has ended. */
  checkIn: CheckIn | null;
}

interface CheckIn {
  closesAt: number;
  /** Who is asked: everyone Playing when it opened, less anyone who has left since. */
  asked: string[];
  answers: Record<string, Mood>;
  /** Once closed: each person asked, with their answer or null for "no Mood". */
  result: Record<string, Mood | null> | null;
}

/** Why a Check-in closed. */
export type CheckInClose = "everyone-answered" | "timeout";

/** How many people answered each Mood, plus how many gave no Mood. */
export interface CheckInTally {
  moods: Record<Mood, number>;
  noMood: number;
}

export type CheckInView =
  /** Everyone sees who has answered, and when it closes. */
  | { status: "open"; closesAt: number; answered: string[] }
  | { status: "closed"; tally: CheckInTally };

/** A Prompt starts with no one in a Mood. */
export function startPromptMoods(): PromptMoods {
  return { current: {}, checkIn: null };
}

export function checkInOpen(moods: PromptMoods): boolean {
  return openOf(moods) !== null;
}

/** When the open Check-in closes if not everyone answers. Undefined if none is open. */
export function checkInClosesAt(moods: PromptMoods): number | undefined {
  return openOf(moods)?.closesAt;
}

/** Whether `personId` may answer the open Check-in. */
export function askedInCheckIn(moods: PromptMoods, personId: string): boolean {
  return openOf(moods)?.asked.includes(personId) ?? false;
}

/**
 * Sets someone's current Mood. While the Check-in is open this is also their
 * answer, so confirming the Mood they have counts too. The Round checks they may.
 */
export function changeMood(moods: PromptMoods, personId: string, mood: Mood): PromptMoods {
  const current = { ...moods.current, [personId]: mood };
  const open = openOf(moods);
  const checkIn = open
    ? { ...open, answers: { ...open.answers, [personId]: mood } }
    : moods.checkIn;
  return { current, checkIn };
}

export function openCheckIn(moods: PromptMoods, asked: string[], now: number): PromptMoods {
  return { ...moods, checkIn: { closesAt: now + CHECK_IN_MS, asked, answers: {}, result: null } };
}

export function everyoneAnswered(moods: PromptMoods): boolean {
  const checkIn = moods.checkIn;
  return checkIn !== null && checkIn.asked.every((id) => checkIn.answers[id] !== undefined);
}

export function checkInDue(moods: PromptMoods, now: number): boolean {
  const open = openOf(moods);
  return open !== null && now >= open.closesAt;
}

/** Closes the open Check-in. Anyone asked who didn't answer is recorded as "no Mood". */
export function closeCheckIn(moods: PromptMoods): PromptMoods {
  const open = openOf(moods);
  if (!open) return moods;
  const result = Object.fromEntries(open.asked.map((id) => [id, open.answers[id] ?? null]));
  return { ...moods, checkIn: { ...open, result } };
}

/** The closed Check-in's answers, by person id (null for "no Mood"). */
export function checkInResult(moods: PromptMoods): Record<string, Mood | null> {
  return moods.checkIn?.result ?? {};
}

/** Forgets someone who left the Room. A closed Check-in stays as it was. */
export function dropFromMoods(moods: PromptMoods, personId: string): PromptMoods {
  const { [personId]: _dropped, ...current } = moods.current;
  const open = openOf(moods);
  const checkIn = open
    ? { ...open, asked: open.asked.filter((id) => id !== personId) }
    : moods.checkIn;
  return { current, checkIn };
}

/** The Check-in, if it's open. */
function openOf(moods: PromptMoods): CheckIn | null {
  return moods.checkIn?.result === null ? moods.checkIn : null;
}

export function viewCheckIn(moods: PromptMoods): CheckInView | null {
  const checkIn = moods.checkIn;
  if (!checkIn) return null;
  if (checkIn.result === null) {
    return {
      status: "open",
      closesAt: checkIn.closesAt,
      answered: checkIn.asked.filter((id) => checkIn.answers[id] !== undefined),
    };
  }
  return { status: "closed", tally: tally(Object.values(checkIn.result)) };
}

function tally(answers: (Mood | null)[]): CheckInTally {
  const moods = Object.fromEntries(MOODS.map((m) => [m.id, 0])) as Record<Mood, number>;
  let noMood = 0;
  for (const answer of answers) {
    if (answer === null) noMood += 1;
    else moods[answer] += 1;
  }
  return { moods, noMood };
}
