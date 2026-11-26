// The Round lifecycle: starting the next Round in the Lineup, moving through
// its Prompts and returning to the Waiting Room. Pure and dependency-free like
// the rest of the Room module. The Room (./room.ts) decides who may act and
// knows who is in the Room; this module decides what a Round does. Format rules
// live in their own modules (./spectrum.ts, ./middle-ground.ts); Moods and the
// Mood Check-in (./mood.ts) belong to every Format.

import { FORMAT_NAMES, type Format, type Lineup, type Prompt, type Round } from "./lineup";
import {
  chooseMiddle,
  choices,
  dropFromMiddleGround,
  endMiddleGroundPrompt,
  everyoneChosen,
  type MiddleGround,
  type MiddleGroundPrompt,
  type MiddleGroundRejectionCode,
  type MiddleGroundView,
  moveToSide,
  nextMiddleGroundPrompt,
  pickSide,
  revealChoices,
  type SideIndex,
  startMiddleGround,
  viewMiddleGround,
} from "./middle-ground";
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

/** The Round being played. Null in the Room state means the Waiting Room. */
export type CurrentRound = SpectrumRound | MiddleGroundRound;

/** What every Round has, whatever its Format. */
interface RoundBase {
  roundId: string;
  /** A copy of the Prompts taken at the start, so Lineup edits don't change a Round mid-play. */
  prompts: Prompt[];
  hostPlaying: boolean;
  promptIndex: number;
  /** The current Prompt's Moods. */
  moods: PromptMoods;
}

type SpectrumRound = RoundBase & { format: "spectrum"; spectrum: SpectrumPrompt };
type MiddleGroundRound = RoundBase & { format: "middle-ground"; middleGround: MiddleGround };

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
  | { type: "set-mood"; mood: Mood }
  /** Middle Ground: picks your own Side for the Round. */
  | { type: "pick-side"; side: SideIndex }
  /** Middle Ground: step into the middle or stay (before the reveal), step in or back out (after). */
  | { type: "choose-middle"; stepIn: boolean };

export type RoundRejectionCode =
  | SpectrumRejectionCode
  | MiddleGroundRejectionCode
  | "wrong-format"
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

/** What set off a reveal: everyone Playing locking in (or choosing), or the Host. */
export type RevealCause = "everyone-locked-in" | "everyone-chose" | "host";

/** What happened in a Round, for the Recap. The Room adds the time. */
export type RoundEvent =
  | { type: "round-started"; roundId: string; format: Format; hostPlaying: boolean }
  | {
      type: "positions-revealed";
      roundId: string;
      promptId: string;
      by: RevealCause;
      positions: Record<string, number | null>;
    }
  | {
      type: "prompt-ended";
      format: "spectrum";
      roundId: string;
      promptId: string;
      /** Where each person locked in (null if they didn't). */
      before: Record<string, number | null>;
      /** Where each person ended up. */
      after: Record<string, number | null>;
    }
  /** Middle Ground: someone picked their own Side. */
  | { type: "side-picked"; roundId: string; personId: string; side: string }
  /** Middle Ground: the Host moved someone to the other Side. */
  | { type: "side-changed"; roundId: string; personId: string; from: string; to: string }
  | {
      type: "choices-revealed";
      roundId: string;
      promptId: string;
      by: RevealCause;
      /** Whether each Playing person chose to step in (null if they didn't choose). */
      choices: Record<string, boolean | null>;
    }
  /** Middle Ground, after the reveal: someone changed position. */
  | {
      type: "stepped-in" | "stepped-back";
      roundId: string;
      promptId: string;
      personId: string;
      /** The name of their Side. */
      side: string;
    }
  | {
      type: "prompt-ended";
      format: "middle-ground";
      roundId: string;
      promptId: string;
      /** How many stepped in from each Side, out of how many were on it, in Side order. */
      sides: { name: string; steppedIn: number; onSide: number }[];
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

export type StageView = StageBase &
  (
    | { format: "spectrum"; spectrum: SpectrumView }
    | { format: "middle-ground"; middleGround: MiddleGroundView }
  );

/** What every Stage shows, whatever the Format. */
interface StageBase {
  roundId: string;
  prompt: { id: string; text: string };
  /** 1-based. */
  promptNumber: number;
  promptCount: number;
  hostPlaying: boolean;
  /** Whether the viewer is Playing this Prompt. */
  playing: boolean;
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
  const { setup } = round;
  if (setup.format === "surrounded") {
    return refuse(
      "format-not-available",
      `${FORMAT_NAMES[setup.format]} Rounds can't be played yet.`,
    );
  }
  if (round.prompts.length === 0) {
    return refuse("round-empty", "This Round has no Prompts yet. Add one to start it.");
  }
  const base: RoundBase = {
    roundId: round.id,
    prompts: round.prompts,
    hostPlaying,
    promptIndex: 0,
    moods: startPromptMoods(),
  };
  const playing = playingIds(hostPlaying, people);
  return {
    round:
      setup.format === "spectrum"
        ? { ...base, format: "spectrum", spectrum: startSpectrumPrompt(playing) }
        : {
            ...base,
            format: "middle-ground",
            middleGround: startMiddleGround(setup.sides, playing),
          },
    events: [{ type: "round-started", roundId: round.id, format: setup.format, hostPlaying }],
  };
}

/** A Playing person's move on the current Prompt. */
export function playRound(
  current: CurrentRound,
  intent: RoundIntent,
  personId: string,
  people: RoundPeople,
): RoundOutcome {
  switch (intent.type) {
    case "set-mood":
      return setMood(current, personId, intent.mood);
    case "move-position":
    case "lock-in": {
      if (current.format !== "spectrum") return WRONG_FORMAT;
      const outcome =
        intent.type === "lock-in"
          ? lockIn(current.spectrum, personId, intent.position)
          : movePosition(current.spectrum, personId, intent.position);
      if ("rejection" in outcome) return outcome;
      return revealIfEveryoneLockedIn({ ...current, spectrum: outcome.prompt });
    }
    case "pick-side": {
      if (current.format !== "middle-ground") return WRONG_FORMAT;
      if (!playingIds(current.hostPlaying, people).includes(personId)) return NOT_IN_ROUND;
      const outcome = pickSide(current.middleGround, personId, intent.side);
      if ("rejection" in outcome) return outcome;
      return {
        round: { ...current, middleGround: outcome.middleGround },
        events: [
          {
            type: "side-picked",
            roundId: current.roundId,
            personId,
            side: current.middleGround.sides[intent.side],
          },
        ],
      };
    }
    case "choose-middle":
      return chooseInMiddleGround(current, personId, intent.stepIn);
  }
}

/** The Host moves someone to a Side. */
export function moveSide(current: CurrentRound, personId: string, side: SideIndex): RoundOutcome {
  if (current.format !== "middle-ground") return WRONG_FORMAT;
  const { middleGround } = current;
  const from = middleGround.sideOf[personId];
  const outcome = moveToSide(middleGround, personId, side);
  if ("rejection" in outcome) return outcome;
  const moved: CurrentRound = { ...current, middleGround: outcome.middleGround };
  if (from === side) return { round: moved, events: [] };
  return {
    round: moved,
    events: [
      {
        type: "side-changed",
        roundId: current.roundId,
        personId,
        from: middleGround.sides[from!],
        to: middleGround.sides[side],
      },
    ],
  };
}

/** The Host reveals the current Prompt's positions or choices without waiting for everyone. */
export function revealPositions(current: CurrentRound): RoundOutcome {
  const { step } = currentPromptState(current);
  if (step !== "positioning" && step !== "choosing") {
    return refuse("already-revealed", "Everyone's already out in the open.");
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
  const { step, playing } = currentPromptState(current);
  switch (step) {
    case "positioning":
    case "choosing":
      return refuse("not-revealed", "Reveal before moving on.");
    case "revealed": {
      const ended = endCurrentPrompt(current);
      const outcome = closeIfEveryoneAnswered({
        ...ended.round,
        moods: openCheckIn(current.moods, playing, now),
      });
      return { round: outcome.round, events: [...ended.events, ...outcome.events] };
    }
    case "summary": {
      if (checkInOpen(current.moods)) {
        return refuse("check-in-open", "Wait for the Mood Check-in to close.");
      }
      const promptIndex = current.promptIndex + 1;
      if (promptIndex >= current.prompts.length) {
        return { round: null, events: [{ type: "round-ended", roundId: current.roundId }] };
      }
      const nextPlaying = playingIds(current.hostPlaying, people);
      const next = { promptIndex, moods: startPromptMoods() };
      return {
        round:
          current.format === "spectrum"
            ? { ...current, ...next, spectrum: startSpectrumPrompt(nextPlaying) }
            : {
                ...current,
                ...next,
                middleGround: nextMiddleGroundPrompt(current.middleGround, nextPlaying),
              },
        events: [],
      };
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
 * Someone left the Room. If they were the last to lock in or choose, the reveal
 * happens; if they were the last to answer the Mood Check-in, it closes.
 */
export function leaveRound(current: CurrentRound, personId: string): RoundOutcome {
  if (current.format === "spectrum") {
    if (!current.spectrum.playing.includes(personId)) return { round: current, events: [] };
    const left: SpectrumRound = {
      ...current,
      spectrum: dropPerson(current.spectrum, personId),
      moods: dropFromMoods(current.moods, personId),
    };
    return checkInOpen(current.moods)
      ? closeIfEveryoneAnswered(left)
      : revealIfEveryoneLockedIn(left);
  }
  const left: MiddleGroundRound = {
    ...current,
    middleGround: dropFromMiddleGround(current.middleGround, personId),
    moods: dropFromMoods(current.moods, personId),
  };
  return checkInOpen(current.moods) ? closeIfEveryoneAnswered(left) : revealIfEveryoneChose(left);
}

export function stageView(
  current: CurrentRound,
  viewer: { personId: string; isHost: boolean; isSpectator: boolean },
  people: RoundPeople,
): StageView {
  const viewerId = viewer.personId;
  const prompt = currentPrompt(current);
  const playing = currentPromptState(current).playing.includes(viewerId);
  // Only those not Playing this Prompt see positions before the reveal. Each
  // Prompt starts fresh, so seeing this one gives a late joiner nothing for the next.
  // Spectators never do: they see what Playing people see, so nothing leaks over the call.
  const seesHidden = !playing && !viewer.isSpectator;
  const checkIn = viewCheckIn(current.moods);
  // The summary card waits until the Mood Check-in has closed.
  const summaryHeld = checkIn?.status === "open";
  const base: StageBase = {
    roundId: current.roundId,
    prompt: { id: prompt.id, text: prompt.text },
    promptNumber: current.promptIndex + 1,
    promptCount: current.prompts.length,
    hostPlaying: current.hostPlaying,
    playing,
    moods: current.moods.current,
    checkIn,
  };
  if (current.format === "spectrum") {
    const spectrum = viewSpectrum(
      current.spectrum,
      { personId: playing ? viewerId : null, seesHidden, seesCallingAids: viewer.isHost },
      people.nicknames,
    );
    return {
      ...base,
      format: "spectrum",
      spectrum: summaryHeld ? { ...spectrum, summary: null } : spectrum,
    };
  }
  const inRound = playingIds(current.hostPlaying, people);
  const middleGround = viewMiddleGround(
    current.middleGround,
    { personId: inRound.includes(viewerId) ? viewerId : null, seesHidden },
    inRound,
    people.nicknames,
  );
  return {
    ...base,
    format: "middle-ground",
    middleGround: summaryHeld ? { ...middleGround, summary: null } : middleGround,
  };
}

function chooseInMiddleGround(
  current: CurrentRound,
  personId: string,
  stepIn: boolean,
): RoundOutcome {
  if (current.format !== "middle-ground") return WRONG_FORMAT;
  const { middleGround } = current;
  const outcome = chooseMiddle(middleGround, personId, stepIn);
  if ("rejection" in outcome) return outcome;
  const chosen: MiddleGroundRound = { ...current, middleGround: outcome.middleGround };
  const { prompt, sideOf, sides } = middleGround;
  if (prompt.step === "choosing") return revealIfEveryoneChose(chosen);
  if (prompt.inMiddle[personId] === stepIn) return { round: chosen, events: [] };
  return {
    round: chosen,
    events: [
      {
        type: stepIn ? "stepped-in" : "stepped-back",
        roundId: current.roundId,
        promptId: currentPrompt(current).id,
        personId,
        side: sides[sideOf[personId]!],
      },
    ],
  };
}

/**
 * Only those Playing the Prompt have a Mood. While the Check-in is open, setting
 * a Mood is the answer to it; once it closes, the Prompt's Moods are final.
 */
function setMood(current: CurrentRound, personId: string, mood: Mood): RoundOutcome {
  if (!isMood(mood)) return refuse("mood-invalid", "That isn't one of the Moods.");
  const { step, playing } = currentPromptState(current);
  const promptOver = step === "summary";
  if (promptOver && !checkInOpen(current.moods)) {
    return refuse("prompt-over", "This Prompt is over, so its Moods are final.");
  }
  const allowed = promptOver ? askedInCheckIn(current.moods, personId) : playing.includes(personId);
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

/** Ends a revealed Prompt: its Format's state freezes for the summary card. */
function endCurrentPrompt(current: CurrentRound): RoundChange {
  const { roundId } = current;
  const promptId = currentPrompt(current).id;
  if (current.format === "spectrum") {
    const { spectrum } = current;
    return {
      round: { ...current, spectrum: endPrompt(spectrum) },
      events: [
        {
          type: "prompt-ended",
          format: "spectrum",
          roundId,
          promptId,
          before: lockedPositions(spectrum),
          after: currentPositions(spectrum),
        },
      ],
    };
  }
  const middleGround = endMiddleGroundPrompt(current.middleGround);
  const summary = middleGround.prompt.summary!;
  return {
    round: { ...current, middleGround },
    events: [
      {
        type: "prompt-ended",
        format: "middle-ground",
        roundId,
        promptId,
        sides: middleGround.sides.map((name, i) => ({
          name,
          steppedIn: summary.steppedIn[i]!,
          onSide: summary.onSide[i]!,
        })),
      },
    ],
  };
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

function revealIfEveryoneLockedIn(current: SpectrumRound): RoundOutcome {
  return current.spectrum.step === "positioning" && everyoneLockedIn(current.spectrum)
    ? revealed(current, "everyone-locked-in")
    : { round: current, events: [] };
}

function revealIfEveryoneChose(current: MiddleGroundRound): RoundOutcome {
  return current.middleGround.prompt.step === "choosing" && everyoneChosen(current.middleGround)
    ? revealed(current, "everyone-chose")
    : { round: current, events: [] };
}

function revealed(current: CurrentRound, by: RevealCause): RoundOutcome {
  const promptId = currentPrompt(current).id;
  if (current.format === "spectrum") {
    const spectrum = reveal(current.spectrum);
    return {
      round: { ...current, spectrum },
      events: [
        {
          type: "positions-revealed",
          roundId: current.roundId,
          promptId,
          by,
          positions: currentPositions(spectrum),
        },
      ],
    };
  }
  return {
    round: { ...current, middleGround: revealChoices(current.middleGround) },
    events: [
      {
        type: "choices-revealed",
        roundId: current.roundId,
        promptId,
        by,
        choices: choices(current.middleGround),
      },
    ],
  };
}

/** The Format's state for the current Prompt: its step and who is Playing it. */
function currentPromptState(current: CurrentRound): SpectrumPrompt | MiddleGroundPrompt {
  return current.format === "spectrum" ? current.spectrum : current.middleGround.prompt;
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

const WRONG_FORMAT: RoundOutcome = {
  rejection: { code: "wrong-format", message: "That's not part of this Round's Format." },
};

const NOT_IN_ROUND: RoundOutcome = {
  rejection: { code: "not-playing", message: "You're not Playing this Round." },
};
