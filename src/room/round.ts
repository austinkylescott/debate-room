// The Round lifecycle: starting the next Round in the Lineup, moving through
// its Prompts and returning to the Waiting Room. Pure and dependency-free like
// the rest of the Room module. The Room (./room.ts) decides who may act and
// knows who is in the Room; this module decides what a Round does. Format rules
// for each Prompt live in their own modules (./spectrum.ts).

import { FORMAT_NAMES, type Format, type Lineup, type Prompt, type Round } from "./lineup";
import {
  currentPositions,
  dropPerson,
  endPrompt,
  everyoneLockedIn,
  lockedPositions,
  lockIn,
  movePosition,
  reveal,
  type SpectrumPrompt,
  type SpectrumRejectionCode,
  type SpectrumView,
  startSpectrumPrompt,
  viewSpectrum,
} from "./spectrum";
import {
  askedInCheckIn,
  changeMood,
  type CheckInClose,
  checkInClosesAt,
  checkInDue,
  checkInOpen,
  checkInResult,
  type CheckInView,
  closeCheckIn,
  dropFromMoods,
  everyoneAnswered,
  isMood,
  type Mood,
  openCheckIn,
  type PromptMoods,
  startPromptMoods,
  viewCheckIn,
} from "./mood";

/** The Round being played. Null in the Room state means the Waiting Room. */
export interface CurrentRound {
  roundId: string;
  format: "spectrum";
  /** A copy of the Prompts taken at the start, so Lineup edits don't change a Round mid-play. */
  prompts: Prompt[];
  hostPlaying: boolean;
  promptIndex: number;
  spectrum: SpectrumPrompt;
  /** The current Prompt's Moods. */
  moods: PromptMoods;
}

/** Who is in the Room, as the Round needs to know it. */
export interface RoundPeople {
  hostId: string;
  /** Participant ids, in Waiting Room order. */
  participantIds: string[];
  nicknames: Map<string, string>;
}

/** What a Playing person does during a Prompt. */
export type RoundIntent =
  | { type: "move-position"; position: number }
  | { type: "lock-in"; position: number }
  | { type: "set-mood"; mood: Mood };

export type RoundRejectionCode =
  | SpectrumRejectionCode
  | "mood-invalid"
  | "check-in-open"
  | "prompt-over"
  | "round-empty"
  | "format-not-available"
  | "already-revealed"
  | "not-revealed";

export interface RoundRejection {
  code: RoundRejectionCode;
  message: string;
}

/** What set off a reveal: everyone Playing locking in, or the Host. */
export type RevealCause = "everyone-locked-in" | "host";

/** What happened in a Round, for the Recap. The Room adds the time. */
export type RoundEvent =
  | { type: "round-started"; roundId: string; format: Format; hostPlaying: boolean }
  | {
      type: "prompt-started";
      roundId: string;
      promptId: string;
      /** 1-based. */
      promptNumber: number;
      text: string;
    }
  /** A move after the reveal. Hovering before it stays hidden, so isn't recorded. */
  | {
      type: "position-moved";
      roundId: string;
      promptId: string;
      personId: string;
      from: number | null;
      to: number;
    }
  | {
      type: "positions-revealed";
      roundId: string;
      promptId: string;
      by: RevealCause;
      positions: Record<string, number | null>;
    }
  | {
      type: "prompt-ended";
      roundId: string;
      promptId: string;
      /** Where each person locked in (null if they didn't). */
      before: Record<string, number | null>;
      /** Where each person ended up. */
      after: Record<string, number | null>;
    }
  | { type: "mood-changed"; roundId: string; promptId: string; personId: string; mood: Mood }
  | {
      type: "mood-check-in-closed";
      roundId: string;
      promptId: string;
      by: CheckInClose;
      /** Each person asked, with their answer, or null for "no Mood". */
      moods: Record<string, Mood | null>;
    }
  | { type: "round-ended"; roundId: string };

/** A changed Round (null once it's over and the Room is back in the Waiting Room). */
export type RoundOutcome =
  | { round: CurrentRound | null; events: RoundEvent[] }
  | { rejection: RoundRejection };

export interface StageView {
  roundId: string;
  format: "spectrum";
  prompt: { id: string; text: string };
  /** 1-based. */
  promptNumber: number;
  promptCount: number;
  hostPlaying: boolean;
  /** Whether the viewer is Playing this Prompt. */
  playing: boolean;
  spectrum: SpectrumView;
  /** Each Playing person's current Mood, by person id. Anyone without one is left out. */
  moods: Record<string, Mood>;
  /** The Mood Check-in once the Prompt has ended: open, then closed with its tally. */
  checkIn: CheckInView | null;
}

/** The first Round in the Lineup that hasn't been played yet. */
export function nextRound(lineup: Lineup, playedRoundIds: string[]): Round | undefined {
  return lineup.rounds.find((r) => !playedRoundIds.includes(r.id));
}

export function startRound(round: Round, hostPlaying: boolean, people: RoundPeople): RoundOutcome {
  if (round.setup.format !== "spectrum") {
    return refuse(
      "format-not-available",
      `${FORMAT_NAMES[round.setup.format]} Rounds can't be played yet.`,
    );
  }
  if (round.prompts.length === 0) {
    return refuse("round-empty", "This Round has no Prompts yet. Add one to start it.");
  }
  const current: CurrentRound = {
    roundId: round.id,
    format: "spectrum",
    prompts: round.prompts,
    hostPlaying,
    promptIndex: 0,
    spectrum: startSpectrumPrompt(playingIds(hostPlaying, people)),
    moods: startPromptMoods(),
  };
  return {
    round: current,
    events: [
      { type: "round-started", roundId: round.id, format: "spectrum", hostPlaying },
      promptStarted(current),
    ],
  };
}

/** A Playing person's move on the current Prompt. */
export function playRound(
  current: CurrentRound,
  intent: RoundIntent,
  personId: string,
): RoundOutcome {
  if (intent.type === "set-mood") return setMood(current, personId, intent.mood);
  const outcome =
    intent.type === "lock-in"
      ? lockIn(current.spectrum, personId, intent.position)
      : movePosition(current.spectrum, personId, intent.position);
  if ("rejection" in outcome) return outcome;
  const moved = { ...current, spectrum: outcome.prompt };
  if (current.spectrum.step === "revealed") {
    const from = currentPositions(current.spectrum)[personId] ?? null;
    const to = intent.position;
    if (from === to) return { round: moved, events: [] };
    const { roundId } = current;
    const promptId = currentPrompt(current).id;
    return {
      round: moved,
      events: [{ type: "position-moved", roundId, promptId, personId, from, to }],
    };
  }
  return revealIfEveryoneLockedIn(moved);
}

/** The Host reveals the current Prompt's positions without waiting for everyone. */
export function revealPositions(current: CurrentRound): RoundOutcome {
  if (current.spectrum.step !== "positioning") {
    return refuse("already-revealed", "The positions are already out.");
  }
  return revealed(current, "host");
}

/**
 * The Host moves the Round on: a revealed Prompt ends and its Mood Check-in
 * opens, then the summary card shows once the Check-in closes; from the summary,
 * the next Prompt starts, or after the last the Round ends. Each Prompt is Played
 * by everyone in the Room when it starts, so late joiners are in from the next one.
 */
export function advanceRound(
  current: CurrentRound,
  people: RoundPeople,
  now: number,
): RoundOutcome {
  const { roundId, spectrum } = current;
  switch (spectrum.step) {
    case "positioning":
      return refuse("not-revealed", "Reveal the positions before moving on.");
    case "revealed": {
      const ended: RoundEvent = {
        type: "prompt-ended",
        roundId,
        promptId: currentPrompt(current).id,
        before: lockedPositions(spectrum),
        after: currentPositions(spectrum),
      };
      const moods = openCheckIn(current.moods, spectrum.playing, now);
      const outcome = closeIfEveryoneAnswered({
        ...current,
        spectrum: endPrompt(spectrum),
        moods,
      });
      return { round: outcome.round, events: [ended, ...outcome.events] };
    }
    case "summary": {
      if (checkInOpen(current.moods)) {
        return refuse("check-in-open", "Wait for the Mood Check-in to close.");
      }
      const promptIndex = current.promptIndex + 1;
      if (promptIndex >= current.prompts.length) {
        return { round: null, events: [{ type: "round-ended", roundId }] };
      }
      const next: CurrentRound = {
        ...current,
        promptIndex,
        spectrum: startSpectrumPrompt(playingIds(current.hostPlaying, people)),
        moods: startPromptMoods(),
      };
      return { round: next, events: [promptStarted(next)] };
    }
  }
}

/** Closes the Mood Check-in once its 15 seconds are up. */
export function tickRound(current: CurrentRound, now: number): RoundOutcome {
  return checkInDue(current.moods, now)
    ? checkInClosed(current, "timeout")
    : { round: current, events: [] };
}

/** When `tickRound` next has something to do: the open Mood Check-in's close. Null if nothing. */
export function nextRoundTimer(current: CurrentRound): number | null {
  return checkInClosesAt(current.moods) ?? null;
}

/**
 * The Host ended the Room mid-Round: the Round ends where it is. A Prompt still
 * being discussed gets no summary card; an open Mood Check-in closes, so its
 * Prompt still gets a tally.
 */
export function abandonRound(current: CurrentRound): RoundOutcome {
  const closed = checkInOpen(current.moods) ? checkInClosed(current, "room-ended").events : [];
  return { round: null, events: [...closed, { type: "round-ended", roundId: current.roundId }] };
}

/**
 * Someone left the Room. If they were the last to lock in, the reveal happens;
 * if they were the last to answer the Mood Check-in, it closes.
 */
export function leaveRound(current: CurrentRound, personId: string): RoundOutcome {
  if (!current.spectrum.playing.includes(personId)) return { round: current, events: [] };
  const left: CurrentRound = {
    ...current,
    spectrum: dropPerson(current.spectrum, personId),
    moods: dropFromMoods(current.moods, personId),
  };
  return checkInOpen(current.moods)
    ? closeIfEveryoneAnswered(left)
    : revealIfEveryoneLockedIn(left);
}

export function stageView(
  current: CurrentRound,
  viewer: { personId: string; isHost: boolean },
  people: RoundPeople,
): StageView {
  const viewerId = viewer.personId;
  const prompt = currentPrompt(current);
  const playing = current.spectrum.playing.includes(viewerId);
  // Only those not Playing this Prompt see positions before the reveal. Each
  // Prompt starts fresh, so seeing this one gives a late joiner nothing for the next.
  const seesHidden = !playing;
  const checkIn = viewCheckIn(current.moods);
  const spectrumView = viewSpectrum(
    current.spectrum,
    { personId: playing ? viewerId : null, seesHidden, seesCallingAids: viewer.isHost },
    people.nicknames,
  );
  return {
    roundId: current.roundId,
    format: current.format,
    prompt: { id: prompt.id, text: prompt.text },
    promptNumber: current.promptIndex + 1,
    promptCount: current.prompts.length,
    hostPlaying: current.hostPlaying,
    playing,
    // The summary card waits until the Mood Check-in has closed.
    spectrum: checkIn?.status === "open" ? { ...spectrumView, summary: null } : spectrumView,
    moods: current.moods.current,
    checkIn,
  };
}

/**
 * Only those Playing the Prompt have a Mood. While the Check-in is open, setting
 * a Mood is the answer to it; once it closes, the Prompt's Moods are final.
 */
function setMood(current: CurrentRound, personId: string, mood: Mood): RoundOutcome {
  if (!isMood(mood)) return refuse("mood-invalid", "That isn't one of the Moods.");
  const promptOver = current.spectrum.step === "summary";
  if (promptOver && !checkInOpen(current.moods)) {
    return refuse("prompt-over", "This Prompt is over, so its Moods are final.");
  }
  const allowed = promptOver
    ? askedInCheckIn(current.moods, personId)
    : current.spectrum.playing.includes(personId);
  if (!allowed) {
    return refuse("not-playing", "Only people Playing this Prompt can set a Mood.");
  }
  const changed = current.moods.current[personId] !== mood;
  const next = { ...current, moods: changeMood(current.moods, personId, mood) };
  const events: RoundEvent[] = changed
    ? [
        {
          type: "mood-changed",
          roundId: current.roundId,
          promptId: currentPrompt(current).id,
          personId,
          mood,
        },
      ]
    : [];
  if (!promptOver) return { round: next, events };
  const outcome = closeIfEveryoneAnswered(next);
  return { round: outcome.round, events: [...events, ...outcome.events] };
}

/** A change to a Round that is still being played. */
interface RoundChange {
  round: CurrentRound;
  events: RoundEvent[];
}

function closeIfEveryoneAnswered(current: CurrentRound): RoundChange {
  return checkInOpen(current.moods) && everyoneAnswered(current.moods)
    ? checkInClosed(current, "everyone-answered")
    : { round: current, events: [] };
}

function checkInClosed(current: CurrentRound, by: CheckInClose): RoundChange {
  const moods = closeCheckIn(current.moods);
  return {
    round: { ...current, moods },
    events: [
      {
        type: "mood-check-in-closed",
        roundId: current.roundId,
        promptId: currentPrompt(current).id,
        by,
        moods: checkInResult(moods),
      },
    ],
  };
}

function revealIfEveryoneLockedIn(current: CurrentRound): RoundOutcome {
  return current.spectrum.step === "positioning" && everyoneLockedIn(current.spectrum)
    ? revealed(current, "everyone-locked-in")
    : { round: current, events: [] };
}

function revealed(current: CurrentRound, by: RevealCause): RoundOutcome {
  const spectrum = reveal(current.spectrum);
  return {
    round: { ...current, spectrum },
    events: [
      {
        type: "positions-revealed",
        roundId: current.roundId,
        promptId: currentPrompt(current).id,
        by,
        positions: currentPositions(spectrum),
      },
    ],
  };
}

function promptStarted(current: CurrentRound): RoundEvent {
  const prompt = currentPrompt(current);
  return {
    type: "prompt-started",
    roundId: current.roundId,
    promptId: prompt.id,
    promptNumber: current.promptIndex + 1,
    text: prompt.text,
  };
}

function currentPrompt(current: CurrentRound): Prompt {
  return current.prompts[current.promptIndex]!;
}

function playingIds(hostPlaying: boolean, people: RoundPeople): string[] {
  return hostPlaying ? [people.hostId, ...people.participantIds] : people.participantIds;
}

function refuse(code: RoundRejectionCode, message: string): RoundOutcome {
  return { rejection: { code, message } };
}
