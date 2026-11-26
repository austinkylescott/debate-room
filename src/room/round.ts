// The Round lifecycle: starting the next Round in the Lineup, moving through
// its Prompts and returning to the Waiting Room. Pure and dependency-free like
// the rest of the Room module. The Room (./room.ts) decides who may act and
// knows who is in the Room; this module decides what a Round does. Format rules
// live in their own modules (./spectrum.ts, ./middle-ground.ts).

import { FORMAT_NAMES, type Format, type Lineup, type Prompt, type Round } from "./lineup";
import {
  chooseMiddle,
  choices,
  dropFromMiddleGround,
  endMiddleGroundPrompt,
  everyoneChosen,
  type MiddleGround,
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

interface RoundBase {
  roundId: string;
  /** A copy of the Prompts taken at the start, so Lineup edits don't change a Round mid-play. */
  prompts: Prompt[];
  hostPlaying: boolean;
  promptIndex: number;
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
  /** Middle Ground: picks your own Side for the Round. */
  | { type: "pick-side"; side: SideIndex }
  /** Middle Ground: step into the middle or stay (before the reveal), step in or back out (after). */
  | { type: "choose-middle"; stepIn: boolean };

export type RoundRejectionCode =
  | SpectrumRejectionCode
  | MiddleGroundRejectionCode
  | "wrong-format"
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

interface StageBase {
  roundId: string;
  prompt: { id: string; text: string };
  /** 1-based. */
  promptNumber: number;
  promptCount: number;
  hostPlaying: boolean;
  /** Whether the viewer is Playing this Prompt. */
  playing: boolean;
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
  const step =
    current.format === "spectrum" ? current.spectrum.step : current.middleGround.prompt.step;
  if (step !== "positioning" && step !== "choosing") {
    return refuse("already-revealed", "Everyone's already out in the open.");
  }
  return revealed(current, "host");
}

/**
 * The Host moves the Round on: a revealed Prompt ends with its summary card; from
 * the summary, the next Prompt starts, or after the last the Round ends. Each
 * Prompt is Played by everyone in the Room when it starts, so late joiners are in
 * from the next one.
 */
export function advanceRound(current: CurrentRound, people: RoundPeople): RoundOutcome {
  const step =
    current.format === "spectrum" ? current.spectrum.step : current.middleGround.prompt.step;
  switch (step) {
    case "positioning":
    case "choosing":
      return refuse("not-revealed", "Reveal before moving on.");
    case "revealed":
      return endCurrentPrompt(current);
    case "summary": {
      const promptIndex = current.promptIndex + 1;
      if (promptIndex >= current.prompts.length) {
        return { round: null, events: [{ type: "round-ended", roundId: current.roundId }] };
      }
      const playing = playingIds(current.hostPlaying, people);
      return {
        round:
          current.format === "spectrum"
            ? { ...current, promptIndex, spectrum: startSpectrumPrompt(playing) }
            : {
                ...current,
                promptIndex,
                middleGround: nextMiddleGroundPrompt(current.middleGround, playing),
              },
        events: [],
      };
    }
  }
}

/** Someone left the Room. If they were the last to lock in or choose, the reveal happens. */
export function leaveRound(current: CurrentRound, personId: string): RoundOutcome {
  if (current.format === "spectrum") {
    if (!current.spectrum.playing.includes(personId)) return { round: current, events: [] };
    return revealIfEveryoneLockedIn({
      ...current,
      spectrum: dropPerson(current.spectrum, personId),
    });
  }
  return revealIfEveryoneChose({
    ...current,
    middleGround: dropFromMiddleGround(current.middleGround, personId),
  });
}

export function stageView(
  current: CurrentRound,
  viewer: { personId: string; isHost: boolean },
  people: RoundPeople,
): StageView {
  const viewerId = viewer.personId;
  const prompt = currentPrompt(current);
  const playingNow =
    current.format === "spectrum" ? current.spectrum.playing : current.middleGround.prompt.playing;
  const playing = playingNow.includes(viewerId);
  // Only those not Playing this Prompt see positions before the reveal. Each
  // Prompt starts fresh, so seeing this one gives a late joiner nothing for the next.
  const seesHidden = !playing;
  const base: StageBase = {
    roundId: current.roundId,
    prompt: { id: prompt.id, text: prompt.text },
    promptNumber: current.promptIndex + 1,
    promptCount: current.prompts.length,
    hostPlaying: current.hostPlaying,
    playing,
  };
  if (current.format === "spectrum") {
    return {
      ...base,
      format: "spectrum",
      spectrum: viewSpectrum(
        current.spectrum,
        { personId: playing ? viewerId : null, seesHidden, seesCallingAids: viewer.isHost },
        people.nicknames,
      ),
    };
  }
  const inRound = playingIds(current.hostPlaying, people);
  return {
    ...base,
    format: "middle-ground",
    middleGround: viewMiddleGround(
      current.middleGround,
      { personId: inRound.includes(viewerId) ? viewerId : null, seesHidden },
      inRound,
      people.nicknames,
    ),
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
  const chosen: CurrentRound = { ...current, middleGround: outcome.middleGround };
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

function endCurrentPrompt(current: CurrentRound): RoundOutcome {
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
