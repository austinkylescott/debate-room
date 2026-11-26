// Surrounded: the rules of a Surrounded Round. One Center defends the Prompts
// for the whole Round; the other people Playing are Challengers, who race to
// take the chair for a timed exchange with the Center. An exchange ends when
// its timer runs out, when a majority of the Challengers not in the chair vote
// to remove the Challenger, when the Center or the Challenger yields, or when
// the Host ends it. Nothing is hidden. Pure and dependency-free like the rest of
// the Room module.

export type SurroundedStep =
  /** Challengers take the chair, one exchange after another. */
  | "exchanges"
  /** The Prompt is over: its summary card is on the Stage. */
  | "summary";

/** How an exchange ended. "left": the Center or the Challenger left the Room. */
export type ExchangeEnd = "timer" | "vote" | "yield" | "host" | "left";

/** Who yielded, for an exchange that ended by a yield. */
export type Yielder = "center" | "challenger";

/** A Surrounded Round in play: the Center, the exchange timer and the current Prompt. */
export interface Surrounded {
  /** The Center for the whole Round. Null until the Host picks one or someone volunteers. */
  centerId: string | null;
  exchangeSeconds: number;
  prompt: SurroundedPrompt;
}

export interface SurroundedPrompt {
  step: SurroundedStep;
  /** Person ids Playing this Prompt, in Waiting Room order. */
  playing: string[];
  /** The exchange running now, if a Challenger is in the chair. */
  chair: Exchange | null;
  /** The Challenger who last left the chair: they can't retake it until someone else has held it. */
  cooldownId: string | null;
  /** The exchanges that have ended on this Prompt, in order. */
  exchanges: EndedExchange[];
}

interface Exchange {
  challengerId: string;
  startedAt: number;
  endsAt: number;
  /** Challengers not in the chair who voted to remove this Challenger, in the order they voted. */
  votes: string[];
}

export interface EndedExchange {
  challengerId: string;
  endedBy: ExchangeEnd;
  /** Who yielded, for an exchange that ended by a yield. */
  yieldedBy?: Yielder;
}

export type SurroundedRejectionCode =
  | "not-playing"
  | "has-center"
  | "no-center"
  | "center-cant-challenge"
  | "chair-taken"
  | "chair-cooldown"
  | "no-exchange"
  | "cant-vote"
  | "cant-yield"
  | "exchanges-over";

export interface SurroundedRejection {
  code: SurroundedRejectionCode;
  message: string;
}

/** What changed, with any exchange that ended and any that started. */
export interface SurroundedChange {
  surrounded: Surrounded;
  ended: EndedExchange | null;
  started: string | null;
  /** A removal vote cast or taken back, if this change was one. */
  vote?: RemovalVote;
}

export interface RemovalVote {
  personId: string;
  challengerId: string;
  remove: boolean;
}

type Outcome = SurroundedChange | { rejection: SurroundedRejection };

export interface SurroundedPersonRef {
  personId: string;
  nickname: string;
}

export interface SurroundedView {
  step: SurroundedStep;
  /** Null until the Host picks a Center or someone volunteers. */
  center: SurroundedPersonRef | null;
  exchangeSeconds: number;
  /** Everyone Playing this Prompt other than the Center, in Waiting Room order. */
  challengers: SurroundedPersonRef[];
  chair: {
    challenger: SurroundedPersonRef;
    startedAt: number;
    endsAt: number;
    /** Who voted to remove the Challenger. Votes are public. */
    votes: SurroundedPersonRef[];
    /** How many votes remove the Challenger: a majority of the Challengers not in the chair. */
    votesNeeded: number;
  } | null;
  /** The Challenger who just left the chair, who can't retake it until someone else has. */
  cooldown: SurroundedPersonRef | null;
  /** The exchanges that have ended on this Prompt, in order. */
  exchanges: (EndedExchange & { nickname: string })[];
  /** The summary card. Only once the Prompt ends. */
  summary: SurroundedSummary | null;
}

/** A Prompt's summary card: how many exchanges there were, and how many ended each way. */
export interface SurroundedSummary {
  exchanges: number;
  endedBy: Record<ExchangeEnd, number>;
}

export function startSurrounded(
  centerId: string | null,
  exchangeSeconds: number,
  playing: string[],
): Surrounded {
  return {
    centerId: centerId !== null && playing.includes(centerId) ? centerId : null,
    exchangeSeconds,
    prompt: startPrompt(playing),
  };
}

/** Starts the next Prompt. The Center carries over for the whole Round. */
export function nextSurroundedPrompt(surrounded: Surrounded, playing: string[]): Surrounded {
  return { ...surrounded, prompt: startPrompt(playing) };
}

/** Someone Playing becomes the Center, while the Round has none. */
export function becomeCenter(surrounded: Surrounded, personId: string): Outcome {
  if (!surrounded.prompt.playing.includes(personId)) return NOT_PLAYING;
  if (surrounded.centerId !== null) {
    return refuse("has-center", "This Round already has its Center.");
  }
  if (surrounded.prompt.step === "summary") return EXCHANGES_OVER;
  // A Challenger in the chair who becomes the Center can't argue with themselves.
  const { chair } = surrounded.prompt;
  if (chair?.challengerId === personId) {
    return refuse("center-cant-challenge", "Leave the chair before stepping up as the Center.");
  }
  return unchangedExchanges({ ...surrounded, centerId: personId });
}

/**
 * A Challenger takes the empty chair, starting an exchange. The first press
 * wins; the Challenger who just left waits until someone else has held it.
 */
export function takeChair(surrounded: Surrounded, personId: string, now: number): Outcome {
  const check = checkChallenger(surrounded, personId);
  if (check) return check;
  const { prompt } = surrounded;
  if (prompt.chair) {
    return refuse("chair-taken", "Someone else got to the chair first.");
  }
  if (prompt.cooldownId === personId) {
    return refuse("chair-cooldown", "You just had the chair. Someone else needs a turn first.");
  }
  return seated(surrounded, personId, now, null);
}

/**
 * The Host puts a Challenger in the chair, whoever holds it and whatever the
 * cooldown. An exchange already running ends, by the Host.
 */
export function seatChallenger(surrounded: Surrounded, personId: string, now: number): Outcome {
  const check = checkChallenger(surrounded, personId);
  if (check) return check;
  const { chair } = surrounded.prompt;
  if (chair?.challengerId === personId) return unchangedExchanges(surrounded);
  if (!chair) return seated(surrounded, personId, now, null);
  const ended = endExchange(surrounded, { challengerId: chair.challengerId, endedBy: "host" });
  return seated(ended.surrounded, personId, now, ended.ended);
}

/**
 * A Challenger not in the chair votes to remove the current Challenger, or
 * takes their vote back. A majority of them ends the exchange.
 */
export function voteToRemove(surrounded: Surrounded, personId: string, remove: boolean): Outcome {
  const { prompt } = surrounded;
  const chair = prompt.chair;
  if (!chair) return NO_EXCHANGE;
  if (!voters(surrounded).includes(personId)) {
    return refuse("cant-vote", "Only Challengers not in the chair vote to remove the Challenger.");
  }
  if (chair.votes.includes(personId) === remove) return unchangedExchanges(surrounded);
  const votes = chair.votes.filter((id) => id !== personId);
  if (remove) votes.push(personId);
  const outcome = removeIfMajority(withChair(surrounded, { ...chair, votes }));
  if ("rejection" in outcome) return outcome;
  return { ...outcome, vote: { personId, challengerId: chair.challengerId, remove } };
}

/** The Center or the Challenger in the chair yields, ending the exchange. */
export function yieldExchange(surrounded: Surrounded, personId: string): Outcome {
  const chair = surrounded.prompt.chair;
  if (!chair) return NO_EXCHANGE;
  const yieldedBy: Yielder | null =
    personId === surrounded.centerId
      ? "center"
      : personId === chair.challengerId
        ? "challenger"
        : null;
  if (yieldedBy === null) {
    return refuse("cant-yield", "Only the Center or the Challenger in the chair can yield.");
  }
  return endExchange(surrounded, { challengerId: chair.challengerId, endedBy: "yield", yieldedBy });
}

/** The Host ends the exchange running now. */
export function hostEndsExchange(surrounded: Surrounded): Outcome {
  const chair = surrounded.prompt.chair;
  if (!chair) return NO_EXCHANGE;
  return endExchange(surrounded, { challengerId: chair.challengerId, endedBy: "host" });
}

/** Ends the exchange if its timer has run out by `now`. */
export function tickSurrounded(surrounded: Surrounded, now: number): SurroundedChange {
  const chair = surrounded.prompt.chair;
  if (!chair || now < chair.endsAt) return unchangedExchanges(surrounded);
  return endExchange(surrounded, { challengerId: chair.challengerId, endedBy: "timer" });
}

/** When the running exchange's timer runs out. Null with no exchange. */
export function exchangeEndsAt(surrounded: Surrounded): number | null {
  return surrounded.prompt.chair?.endsAt ?? null;
}

/** Ends the Prompt: an exchange still running ends by the Host, and the summary card shows. */
export function endSurroundedPrompt(surrounded: Surrounded): SurroundedChange {
  const chair = surrounded.prompt.chair;
  const ended = chair
    ? endExchange(surrounded, { challengerId: chair.challengerId, endedBy: "host" })
    : unchangedExchanges(surrounded);
  return {
    ...ended,
    surrounded: {
      ...ended.surrounded,
      prompt: { ...ended.surrounded.prompt, step: "summary" },
    },
  };
}

/**
 * Drops someone who left the Room. An exchange they were in ends; a Center who
 * leaves leaves the Round open to a new one. A vote they cast goes, which can
 * leave a majority to remove the Challenger. Once the Prompt is over, it stays as it was.
 */
export function dropFromSurrounded(surrounded: Surrounded, personId: string): SurroundedChange {
  const centerId = surrounded.centerId === personId ? null : surrounded.centerId;
  const { prompt } = surrounded;
  if (prompt.step === "summary" || !prompt.playing.includes(personId)) {
    return unchangedExchanges({ ...surrounded, centerId });
  }
  const chair = prompt.chair;
  const left: Surrounded = {
    ...surrounded,
    centerId,
    prompt: {
      ...prompt,
      playing: prompt.playing.filter((id) => id !== personId),
      cooldownId: prompt.cooldownId === personId ? null : prompt.cooldownId,
      chair: chair && { ...chair, votes: chair.votes.filter((id) => id !== personId) },
    },
  };
  if (chair && (chair.challengerId === personId || surrounded.centerId === personId)) {
    return endExchange(left, { challengerId: chair.challengerId, endedBy: "left" });
  }
  const outcome = removeIfMajority(left);
  return "rejection" in outcome ? unchangedExchanges(left) : outcome;
}

/** Who has the Floor by the Format's rules: the Center, and the Challenger in the chair. */
export function surroundedSpeakers(surrounded: Surrounded): string[] {
  const { centerId, prompt } = surrounded;
  if (prompt.step === "summary") return [];
  return [centerId, prompt.chair?.challengerId ?? null].filter((id): id is string => id !== null);
}

export function viewSurrounded(
  surrounded: Surrounded,
  nicknames: Map<string, string>,
): SurroundedView {
  const { prompt, centerId } = surrounded;
  const ref = (personId: string): SurroundedPersonRef => ({
    personId,
    nickname: nicknames.get(personId) ?? "",
  });
  const chair = prompt.chair;
  return {
    step: prompt.step,
    center: centerId === null ? null : ref(centerId),
    exchangeSeconds: surrounded.exchangeSeconds,
    challengers: prompt.playing.filter((id) => id !== centerId).map(ref),
    chair: chair && {
      challenger: ref(chair.challengerId),
      startedAt: chair.startedAt,
      endsAt: chair.endsAt,
      votes: chair.votes.map(ref),
      votesNeeded: votesNeeded(surrounded),
    },
    cooldown: prompt.cooldownId === null ? null : ref(prompt.cooldownId),
    exchanges: prompt.exchanges.map((e) => ({ ...e, nickname: ref(e.challengerId).nickname })),
    summary: prompt.step === "summary" ? summarizeExchanges(prompt.exchanges) : null,
  };
}

export function summarizeExchanges(exchanges: EndedExchange[]): SurroundedSummary {
  const endedBy: Record<ExchangeEnd, number> = { timer: 0, vote: 0, yield: 0, host: 0, left: 0 };
  for (const e of exchanges) endedBy[e.endedBy] += 1;
  return { exchanges: exchanges.length, endedBy };
}

function startPrompt(playing: string[]): SurroundedPrompt {
  return { step: "exchanges", playing, chair: null, cooldownId: null, exchanges: [] };
}

/** Refuses someone who can't be a Challenger right now. */
function checkChallenger(surrounded: Surrounded, personId: string): Outcome | null {
  const { prompt } = surrounded;
  if (!prompt.playing.includes(personId)) return NOT_PLAYING;
  if (prompt.step === "summary") return EXCHANGES_OVER;
  if (surrounded.centerId === null) {
    return refuse("no-center", "The chair opens once the Round has its Center.");
  }
  if (surrounded.centerId === personId) {
    return refuse("center-cant-challenge", "The Center defends: they don't take the chair.");
  }
  return null;
}

function seated(
  surrounded: Surrounded,
  challengerId: string,
  now: number,
  ended: EndedExchange | null,
): SurroundedChange {
  const { prompt } = surrounded;
  return {
    surrounded: {
      ...surrounded,
      prompt: {
        ...prompt,
        // Someone else holding the chair lets the last Challenger back in.
        cooldownId: null,
        chair: {
          challengerId,
          startedAt: now,
          endsAt: now + surrounded.exchangeSeconds * 1000,
          votes: [],
        },
      },
    },
    ended,
    started: challengerId,
  };
}

function endExchange(surrounded: Surrounded, ended: EndedExchange): SurroundedChange {
  const { prompt } = surrounded;
  return {
    surrounded: {
      ...surrounded,
      prompt: {
        ...prompt,
        chair: null,
        // Someone who left the Room has nothing to wait for.
        cooldownId: ended.endedBy === "left" ? null : ended.challengerId,
        exchanges: [...prompt.exchanges, ended],
      },
    },
    ended,
    started: null,
  };
}

/** The Challengers not in the chair: everyone Playing but the Center and the Challenger. */
function voters(surrounded: Surrounded): string[] {
  const { prompt, centerId } = surrounded;
  return prompt.playing.filter((id) => id !== centerId && id !== prompt.chair?.challengerId);
}

/** A majority of the Challengers not in the chair. */
function votesNeeded(surrounded: Surrounded): number {
  return Math.floor(voters(surrounded).length / 2) + 1;
}

function removeIfMajority(surrounded: Surrounded): Outcome {
  const chair = surrounded.prompt.chair;
  if (!chair || chair.votes.length < votesNeeded(surrounded)) {
    return unchangedExchanges(surrounded);
  }
  return endExchange(surrounded, { challengerId: chair.challengerId, endedBy: "vote" });
}

function withChair(surrounded: Surrounded, chair: Exchange): Surrounded {
  return { ...surrounded, prompt: { ...surrounded.prompt, chair } };
}

function unchangedExchanges(surrounded: Surrounded): SurroundedChange {
  return { surrounded, ended: null, started: null };
}

function refuse(code: SurroundedRejectionCode, message: string): Outcome {
  return { rejection: { code, message } };
}

const NOT_PLAYING = refuse(
  "not-playing",
  "You're not Playing this Prompt. You'll be in from the next one.",
);

const NO_EXCHANGE = refuse("no-exchange", "Nobody is in the chair right now.");

const EXCHANGES_OVER = refuse("exchanges-over", "This Prompt is over.");
