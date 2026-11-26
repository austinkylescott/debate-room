// The Round lifecycle: starting the next Round in the Lineup, moving through
// its Prompts and returning to the Waiting Room. Pure and dependency-free like
// the rest of the Room module. The Room (./room.ts) decides who may act and
// knows who is in the Room; this module decides what a Round does. Format rules
// live in their own modules (./spectrum.ts, ./middle-ground.ts, ./surrounded.ts); Moods and the
// Mood Check-in (./mood.ts) belong to every Format.

import type { Format, Lineup, Prompt, Round } from "./lineup";
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
  notchesCrossed,
  reveal,
  type SpectrumPrompt,
  type SpectrumRejectionCode,
  type SpectrumView,
  startSpectrumPrompt,
  viewSpectrum,
} from "./spectrum";
import {
  becomeCenter,
  dropFromSurrounded,
  type EndedExchange,
  endSurroundedPrompt,
  exchangeEndsAt,
  hostEndsExchange,
  nextSurroundedPrompt,
  seatChallenger,
  startSurrounded,
  type Surrounded,
  type SurroundedChange,
  type SurroundedPrompt,
  type SurroundedRejection,
  type SurroundedRejectionCode,
  surroundedSpeakers,
  type SurroundedView,
  takeChair,
  tickSurrounded,
  viewSurrounded,
  voteToRemove,
  yieldExchange,
} from "./surrounded";

/** The Round being played. Null in the Room state means the Waiting Room. */
export type CurrentRound = SpectrumRound | MiddleGroundRound | SurroundedRound;

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
type SurroundedRound = RoundBase & { format: "surrounded"; surrounded: Surrounded };

/** Who is in the Room, as the Round needs to know it. */
export interface RoundPeople {
  hostId: string;
  /** Participant ids, in Waiting Room order. */
  participantIds: string[];
  nicknames: Map<string, string>;
}

/** What a Playing person does during a Prompt. */
export type RoundIntent =
  /**
   * `settled`: the slider was let go here, so a move after the reveal is
   * recorded in the Recap wherever it lands. Moves in between are recorded only
   * where they cross a notch.
   */
  | { type: "move-position"; position: number; settled?: boolean }
  | { type: "lock-in"; position: number }
  | { type: "set-mood"; mood: Mood }
  /** Middle Ground: picks your own Side for the Round. */
  | { type: "pick-side"; side: SideIndex }
  /** Middle Ground: step into the middle or stay (before the reveal), step in or back out (after). */
  | { type: "choose-middle"; stepIn: boolean }
  /** Surrounded: step up as the Center, while the Round has none. */
  | { type: "volunteer-center" }
  /** Surrounded: a Challenger takes the empty chair. The first press wins. */
  | { type: "take-chair" }
  /** Surrounded: a Challenger not in the chair votes to remove the Challenger, or takes it back. */
  | { type: "vote-remove"; remove: boolean }
  /** Surrounded: the Center or the Challenger in the chair ends the exchange. */
  | { type: "yield-chair" };

/** What the Host does in a Surrounded Round. */
export type SurroundedControl =
  /** Makes someone Playing the Center, while the Round has none. */
  | { type: "choose-center"; personId: string }
  /** Ends the exchange running now. */
  | { type: "end-exchange" }
  /** Puts a Challenger in the chair, ending any exchange running now. */
  | { type: "seat-challenger"; personId: string };

export type RoundRejectionCode =
  | SpectrumRejectionCode
  | MiddleGroundRejectionCode
  | SurroundedRejectionCode
  | "wrong-format"
  | "mood-invalid"
  | "check-in-open"
  | "prompt-over"
  | "round-empty"
  | "center-not-playing"
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
      type: "prompt-started";
      roundId: string;
      promptId: string;
      /** 1-based. */
      promptNumber: number;
      text: string;
    }
  /**
   * Spectrum, after the reveal: someone's slider crossed a notch (`position` is
   * the notch), or settled where they let it go. Hovering before the reveal
   * stays hidden, so it isn't recorded; nor is jitter between notches.
   */
  | {
      type: "position-moved";
      roundId: string;
      promptId: string;
      personId: string;
      position: number;
      reason: "notch" | "settled";
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
  /** Surrounded: the Round has its Center, picked by the Host or stepping up. */
  | { type: "center-chosen"; roundId: string; personId: string; by: "host" | "volunteer" }
  /** Surrounded: a Challenger is in the chair, by taking it or put there by the Host. */
  | {
      type: "chair-taken";
      roundId: string;
      promptId: string;
      personId: string;
      by: "challenger" | "host";
    }
  /** Surrounded: a Challenger not in the chair voted to remove the Challenger, or took it back. */
  | {
      type: "removal-vote";
      roundId: string;
      promptId: string;
      personId: string;
      challengerId: string;
      remove: boolean;
    }
  | ({ type: "exchange-ended"; roundId: string; promptId: string } & EndedExchange)
  | {
      type: "prompt-ended";
      format: "surrounded";
      roundId: string;
      promptId: string;
      /** Every exchange on the Prompt, in order, with how it ended. */
      exchanges: EndedExchange[];
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
    | { format: "surrounded"; surrounded: SurroundedView }
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
  if (setup.format === "surrounded" && setup.centerId === people.hostId && !hostPlaying) {
    return refuse("center-not-playing", "You're this Round's Center, so you need to be Playing.");
  }
  const current: CurrentRound =
    setup.format === "spectrum"
      ? { ...base, format: "spectrum", spectrum: startSpectrumPrompt(playing) }
      : setup.format === "middle-ground"
        ? {
            ...base,
            format: "middle-ground",
            middleGround: startMiddleGround(setup.sides, playing),
          }
        : {
            ...base,
            format: "surrounded",
            surrounded: startSurrounded(setup.centerId, setup.exchangeSeconds, playing),
          };
  const centerId = current.format === "surrounded" ? current.surrounded.centerId : null;
  const centerChosen: RoundEvent[] =
    centerId === null
      ? []
      : [{ type: "center-chosen", roundId: round.id, personId: centerId, by: "host" }];
  return {
    round: current,
    events: [
      { type: "round-started", roundId: round.id, format: setup.format, hostPlaying },
      ...centerChosen,
      promptStarted(current),
    ],
  };
}

/** A Playing person's move on the current Prompt. */
export function playRound(
  current: CurrentRound,
  intent: RoundIntent,
  personId: string,
  people: RoundPeople,
  now: number,
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
      const moved: SpectrumRound = { ...current, spectrum: outcome.prompt };
      if (current.spectrum.step !== "revealed") return revealIfEveryoneLockedIn(moved);
      return { round: moved, events: movedEvents(current, personId, intent) };
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
    case "volunteer-center":
      return inSurrounded(current, (s) => becomeCenter(s, personId), { centerBy: "volunteer" });
    case "take-chair":
      return inSurrounded(current, (s) => takeChair(s, personId, now), { chairBy: "challenger" });
    case "vote-remove":
      return inSurrounded(current, (s) => voteToRemove(s, personId, intent.remove));
    case "yield-chair":
      return inSurrounded(current, (s) => yieldExchange(s, personId));
  }
}

/** A Host control in a Surrounded Round. */
export function controlSurrounded(
  current: CurrentRound,
  control: SurroundedControl,
  now: number,
): RoundOutcome {
  switch (control.type) {
    case "choose-center":
      return inSurrounded(current, (s) => becomeCenter(s, control.personId), { centerBy: "host" });
    case "end-exchange":
      return inSurrounded(current, hostEndsExchange);
    case "seat-challenger":
      return inSurrounded(current, (s) => seatChallenger(s, control.personId, now), {
        chairBy: "host",
      });
  }
}

/**
 * Who has the Floor by the Format's rules (Surrounded: the Center and the
 * Challenger in the chair). The Room keeps the Floor in step as these change,
 * and the Host can still give and take it by hand in between.
 */
export function formatSpeakers(current: CurrentRound): string[] {
  return current.format === "surrounded" ? surroundedSpeakers(current.surrounded) : [];
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
  if (current.format === "surrounded") return WRONG_FORMAT;
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
    case "revealed":
    case "exchanges": {
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
      const nextRound: CurrentRound =
        current.format === "spectrum"
          ? { ...current, ...next, spectrum: startSpectrumPrompt(nextPlaying) }
          : current.format === "middle-ground"
            ? {
                ...current,
                ...next,
                middleGround: nextMiddleGroundPrompt(current.middleGround, nextPlaying),
              }
            : {
                ...current,
                ...next,
                surrounded: nextSurroundedPrompt(current.surrounded, nextPlaying),
              };
      return { round: nextRound, events: [promptStarted(nextRound)] };
    }
  }
}

/**
 * Closes the Mood Check-in once its 15 seconds are up, and ends a Surrounded
 * exchange whose timer has run out.
 */
export function tickRound(current: CurrentRound, now: number): RoundOutcome {
  if (checkInDue(current.moods, now)) return checkInClosed(current, "timeout");
  if (current.format === "surrounded") {
    const ticked = tickSurrounded(current.surrounded, now);
    if (ticked.ended) return inSurrounded(current, () => ticked);
  }
  return { round: current, events: [] };
}

/**
 * When `tickRound` next has something to do: the open Mood Check-in's close or
 * the running exchange's end, whichever is sooner. Null if nothing.
 */
export function nextRoundTimer(current: CurrentRound): number | null {
  const due = [
    checkInClosesAt(current.moods) ?? null,
    current.format === "surrounded" ? exchangeEndsAt(current.surrounded) : null,
  ].filter((at): at is number => at !== null);
  return due.length > 0 ? Math.min(...due) : null;
}

/**
 * The Host ended the Room mid-Round: the Round ends where it is. A revealed
 * Prompt ends with its summary card; one still hidden ends without, so nothing
 * hidden comes out. An open Mood Check-in closes, so its Prompt keeps a tally.
 */
export function abandonRound(current: CurrentRound): RoundOutcome {
  const roundEnded: RoundEvent = { type: "round-ended", roundId: current.roundId };
  const { step } = currentPromptState(current);
  // Nothing in a Surrounded Prompt is hidden, so it always ends with its summary card.
  if (step === "revealed" || step === "exchanges") {
    return { round: null, events: [...endCurrentPrompt(current).events, roundEnded] };
  }
  const closed = checkInOpen(current.moods) ? checkInClosed(current, "room-ended").events : [];
  return { round: null, events: [...closed, roundEnded] };
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
  if (current.format === "surrounded") {
    const dropped = inSurrounded(current, (s) => dropFromSurrounded(s, personId));
    if ("rejection" in dropped || !dropped.round) return dropped;
    const left = { ...dropped.round, moods: dropFromMoods(current.moods, personId) };
    const closed = closeIfEveryoneAnswered(left);
    return { round: closed.round, events: [...dropped.events, ...closed.events] };
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
  if (current.format === "surrounded") {
    const surrounded = viewSurrounded(current.surrounded, people.nicknames);
    return {
      ...base,
      format: "surrounded",
      surrounded: summaryHeld ? { ...surrounded, summary: null } : surrounded,
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

/**
 * What a Spectrum move after the reveal adds to the Recap: each notch it
 * crosses, then where it settles if the slider was let go.
 */
function movedEvents(
  current: SpectrumRound,
  personId: string,
  intent: { position: number; settled?: boolean },
): RoundEvent[] {
  const from = currentPositions(current.spectrum)[personId] ?? null;
  const base = { roundId: current.roundId, promptId: currentPrompt(current).id, personId };
  const crossed = from === null ? [] : notchesCrossed(from, intent.position);
  const events: RoundEvent[] = crossed.map((position) => ({
    type: "position-moved",
    ...base,
    position,
    reason: "notch",
  }));
  // The last move while dragging has often reached the same spot already; the
  // settle is still recorded, unless this move recorded it as a notch.
  if (intent.settled && crossed.at(-1) !== intent.position) {
    events.push({ type: "position-moved", ...base, position: intent.position, reason: "settled" });
  }
  return events;
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
  if (current.format === "surrounded") {
    const ended = endSurroundedPrompt(current.surrounded);
    const exchangeEnded: RoundEvent[] = ended.ended
      ? [{ type: "exchange-ended", roundId, promptId, ...ended.ended }]
      : [];
    return {
      round: { ...current, surrounded: ended.surrounded },
      events: [
        ...exchangeEnded,
        {
          type: "prompt-ended",
          format: "surrounded",
          roundId,
          promptId,
          exchanges: ended.surrounded.prompt.exchanges,
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

function revealed(current: SpectrumRound | MiddleGroundRound, by: RevealCause): RoundOutcome {
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
function currentPromptState(
  current: CurrentRound,
): SpectrumPrompt | MiddleGroundPrompt | SurroundedPrompt {
  switch (current.format) {
    case "spectrum":
      return current.spectrum;
    case "middle-ground":
      return current.middleGround.prompt;
    case "surrounded":
      return current.surrounded.prompt;
  }
}

/**
 * Applies a change to a Surrounded Round and works out its Recap events, in
 * the order they happened: a vote, an exchange ending, a new Center, a new
 * Challenger in the chair.
 */
function inSurrounded(
  current: CurrentRound,
  change: (surrounded: Surrounded) => SurroundedChange | { rejection: SurroundedRejection },
  record: {
    centerBy?: "host" | "volunteer";
    chairBy?: "challenger" | "host";
  } = {},
): RoundOutcome {
  if (current.format !== "surrounded") return WRONG_FORMAT;
  const outcome = change(current.surrounded);
  if ("rejection" in outcome) return outcome;
  const base = { roundId: current.roundId, promptId: currentPrompt(current).id };
  const events: RoundEvent[] = [];
  if (outcome.vote) events.push({ type: "removal-vote", ...base, ...outcome.vote });
  if (outcome.ended) events.push({ type: "exchange-ended", ...base, ...outcome.ended });
  const { centerId } = outcome.surrounded;
  if (record.centerBy && centerId !== null && centerId !== current.surrounded.centerId) {
    events.push({
      type: "center-chosen",
      roundId: current.roundId,
      personId: centerId,
      by: record.centerBy,
    });
  }
  if (record.chairBy && outcome.started !== null) {
    events.push({ type: "chair-taken", ...base, personId: outcome.started, by: record.chairBy });
  }
  return { round: { ...current, surrounded: outcome.surrounded }, events };
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
