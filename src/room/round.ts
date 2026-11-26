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

/** The Round being played. Null in the Room state means the Waiting Room. */
export interface CurrentRound {
  roundId: string;
  format: "spectrum";
  /** A copy of the Prompts taken at the start, so Lineup edits don't change a Round mid-play. */
  prompts: Prompt[];
  hostPlaying: boolean;
  promptIndex: number;
  spectrum: SpectrumPrompt;
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
  | { type: "lock-in"; position: number };

export type RoundRejectionCode =
  | SpectrumRejectionCode
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
 * The Host moves the Round on: a revealed Prompt ends with its summary card; from
 * the summary, the next Prompt starts, or after the last the Round ends. Each
 * Prompt is Played by everyone in the Room when it starts, so late joiners are in
 * from the next one.
 */
export function advanceRound(current: CurrentRound, people: RoundPeople): RoundOutcome {
  const { roundId, spectrum } = current;
  switch (spectrum.step) {
    case "positioning":
      return refuse("not-revealed", "Reveal the positions before moving on.");
    case "revealed":
      return {
        round: { ...current, spectrum: endPrompt(spectrum) },
        events: [
          {
            type: "prompt-ended",
            roundId,
            promptId: currentPrompt(current).id,
            before: lockedPositions(spectrum),
            after: currentPositions(spectrum),
          },
        ],
      };
    case "summary": {
      const promptIndex = current.promptIndex + 1;
      if (promptIndex >= current.prompts.length) {
        return { round: null, events: [{ type: "round-ended", roundId }] };
      }
      const next: CurrentRound = {
        ...current,
        promptIndex,
        spectrum: startSpectrumPrompt(playingIds(current.hostPlaying, people)),
      };
      return { round: next, events: [promptStarted(next)] };
    }
  }
}

/** Someone left the Room. If they were the last to lock in, the reveal happens. */
export function leaveRound(current: CurrentRound, personId: string): RoundOutcome {
  if (!current.spectrum.playing.includes(personId)) return { round: current, events: [] };
  return revealIfEveryoneLockedIn({ ...current, spectrum: dropPerson(current.spectrum, personId) });
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
  return {
    roundId: current.roundId,
    format: current.format,
    prompt: { id: prompt.id, text: prompt.text },
    promptNumber: current.promptIndex + 1,
    promptCount: current.prompts.length,
    hostPlaying: current.hostPlaying,
    playing,
    spectrum: viewSpectrum(
      current.spectrum,
      { personId: playing ? viewerId : null, seesHidden, seesCallingAids: viewer.isHost },
      people.nicknames,
    ),
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
