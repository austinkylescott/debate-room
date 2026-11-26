// Views derived from the Recap's events: Floor time per person, and each Round
// with its Prompts: reveals, moves (Spectrum) or step-ins (Middle Ground),
// summary cards and Mood events. Nothing here is stored: it's all computed from
// the append-only event list, so a client can rebuild it from the Recap stream
// or a downloaded copy. Pure and dependency-free like the rest of the Room module.

import type { Format } from "./lineup";
import {
  type MoodOverviewEntry,
  moodOverview,
  type PositionChange,
  type PromptMoodInsights,
  promptMoodInsights,
} from "./recap-moods";
import { HOST_PERSON_ID, type JoinRole, type RecapEvent } from "./room";
import type { RevealCause } from "./round";
import { type Distribution, distribution, nearestNotch } from "./spectrum";

export interface RecapSummary {
  /** Everyone who joined the Room, in the order they joined, the Host first. */
  people: RecapPerson[];
  /** Everyone who has had the Floor, most Floor time first. */
  floorTime: { personId: string; nickname: string; ms: number }[];
  rounds: RecapRound[];
  /** Across the Room: every Prompt played, with its Moods at a glance. */
  moodOverview: MoodOverviewEntry[];
  /** When the Host ended the Room, or null while it's Live. */
  endedAt: number | null;
}

export interface RecapPerson {
  personId: string;
  /** Their latest nickname. */
  nickname: string;
  joinedAs: "host" | JoinRole;
  joinedAt: number;
  /** When a Spectator switched to Participant, or null if they never did. */
  becameParticipantAt: number | null;
  /** When the Host removed them, or null. */
  removedAt: number | null;
  /** Each time they were made a Co-Host, revoked or stepped down, in order. */
  coHost: { at: number; change: "granted" | "revoked" | "stepped-down" }[];
}

export interface RecapRound {
  roundId: string;
  format: Format;
  startedAt: number;
  endedAt: number | null;
  /** Middle Ground: each Side someone picked, or was moved to by the Host, in order. */
  sides: { at: number; personId: string; nickname: string; side: string; from: string | null }[];
  prompts: RecapPrompt[];
}

export interface RecapPrompt {
  promptId: string;
  /** 1-based. */
  promptNumber: number;
  text: string;
  startedAt: number;
  /** When the Prompt ended, or its Round did. Null while it's being played. */
  endedAt: number | null;
  /** Set for a Spectrum Prompt. */
  spectrum: RecapSpectrum | null;
  /** Set for a Middle Ground Prompt. */
  middleGround: RecapMiddleGround | null;
  /**
   * The Prompt's Mood changes and its Check-in close, as recorded. The Mood
   * insights below are derived from these.
   */
  moodEvents: MoodRecapEvent[];
  moods: PromptMoodInsights;
}

export interface RecapSpectrum {
  revealed: {
    at: number;
    by: RevealCause;
    positions: { personId: string; nickname: string; position: number | null }[];
  } | null;
  /** Moves after the reveal, in order: each notch crossed, and where the slider settled. */
  moves: {
    at: number;
    personId: string;
    nickname: string;
    from: number | null;
    to: number;
    reason: "notch" | "settled";
  }[];
  /** The summary card: where people locked in, and where they ended up. Only once the Prompt ends. */
  summary: { before: Distribution; after: Distribution } | null;
}

export interface RecapMiddleGround {
  revealed: {
    at: number;
    by: RevealCause;
    /** Each Playing person's Side, and whether they stepped in (null if they didn't choose). */
    choices: {
      personId: string;
      nickname: string;
      side: string | null;
      steppedIn: boolean | null;
    }[];
  } | null;
  /** Step-ins and step-backs after the reveal, in order. */
  steps: { at: number; personId: string; nickname: string; side: string; steppedIn: boolean }[];
  /** The summary card: how many stepped in from each Side. Only once the Prompt ends. */
  summary: { sides: { name: string; steppedIn: number; onSide: number }[] } | null;
}

export type MoodRecapEvent = Extract<
  RecapEvent,
  { type: "mood-changed" } | { type: "mood-check-in-closed" }
>;

/** A Round as the events are read: its Prompts' Mood insights come once all are in. */
type RoundSoFar = Omit<RecapRound, "prompts"> & { prompts: Omit<RecapPrompt, "moods">[] };

/**
 * Builds the Recap's derived views from its events. Floor turns still running
 * count up to `now`, or up to the end of the Room once it has Ended. Events this
 * function doesn't know (such as ones added by later features) are skipped.
 */
export function summarizeRecap(events: RecapEvent[], now: number): RecapSummary {
  const names = nicknames(events);
  const nickname = (personId: string) => names.get(personId) ?? "";

  const floorMs = new Map<string, number>();
  const floorSince = new Map<string, number>();
  const endFloorTurn = (personId: string, at: number) => {
    const since = floorSince.get(personId);
    if (since === undefined) return;
    floorMs.set(personId, (floorMs.get(personId) ?? 0) + at - since);
    floorSince.delete(personId);
  };

  const rounds: RoundSoFar[] = [];
  let endedAt: number | null = null;
  const currentRound = () => rounds.at(-1);
  const currentPrompt = () => currentRound()?.prompts.at(-1);
  /** Middle Ground: each person's Side in the current Round. */
  let sideOf = new Map<string, string>();
  /** Spectrum: each person's last known position on the current Prompt. */
  let positionOf = new Map<string, number | null>();

  for (const event of events) {
    switch (event.type) {
      case "floor-given":
        if (!floorSince.has(event.personId)) floorSince.set(event.personId, event.at);
        break;
      case "floor-taken":
        endFloorTurn(event.personId, event.at);
        break;
      case "round-started":
        rounds.push({
          roundId: event.roundId,
          format: event.format,
          startedAt: event.at,
          endedAt: null,
          sides: [],
          prompts: [],
        });
        sideOf = new Map();
        break;
      case "prompt-started": {
        const round = currentRound();
        if (!round) break;
        round.prompts.push({
          promptId: event.promptId,
          promptNumber: event.promptNumber,
          text: event.text,
          startedAt: event.at,
          endedAt: null,
          spectrum:
            round.format === "spectrum" ? { revealed: null, moves: [], summary: null } : null,
          middleGround:
            round.format === "middle-ground" ? { revealed: null, steps: [], summary: null } : null,
          moodEvents: [],
        });
        positionOf = new Map();
        break;
      }
      case "mood-changed":
      case "mood-check-in-closed":
        currentPrompt()?.moodEvents.push(event);
        break;
      case "positions-revealed": {
        const spectrum = currentPrompt()?.spectrum;
        if (!spectrum) break;
        positionOf = new Map(Object.entries(event.positions));
        spectrum.revealed = {
          at: event.at,
          by: event.by,
          positions: [...positionOf].map(([personId, position]) => ({
            personId,
            nickname: nickname(personId),
            position,
          })),
        };
        break;
      }
      case "position-moved": {
        const spectrum = currentPrompt()?.spectrum;
        if (!spectrum) break;
        spectrum.moves.push({
          at: event.at,
          personId: event.personId,
          nickname: nickname(event.personId),
          from: positionOf.get(event.personId) ?? null,
          to: event.position,
          reason: event.reason,
        });
        positionOf.set(event.personId, event.position);
        break;
      }
      case "side-picked":
      case "side-changed": {
        const round = currentRound();
        if (!round) break;
        const side = event.type === "side-picked" ? event.side : event.to;
        round.sides.push({
          at: event.at,
          personId: event.personId,
          nickname: nickname(event.personId),
          side,
          from: event.type === "side-changed" ? event.from : null,
        });
        sideOf.set(event.personId, side);
        break;
      }
      case "choices-revealed": {
        const middleGround = currentPrompt()?.middleGround;
        if (!middleGround) break;
        middleGround.revealed = {
          at: event.at,
          by: event.by,
          choices: Object.entries(event.choices).map(([personId, steppedIn]) => ({
            personId,
            nickname: nickname(personId),
            side: sideOf.get(personId) ?? null,
            steppedIn,
          })),
        };
        break;
      }
      case "stepped-in":
      case "stepped-back":
        currentPrompt()?.middleGround?.steps.push({
          at: event.at,
          personId: event.personId,
          nickname: nickname(event.personId),
          side: event.side,
          steppedIn: event.type === "stepped-in",
        });
        break;
      case "prompt-ended": {
        const prompt = currentPrompt();
        if (!prompt) break;
        prompt.endedAt = event.at;
        if (event.format === "spectrum" && prompt.spectrum) {
          prompt.spectrum.summary = {
            before: distribution(Object.values(event.before)),
            after: distribution(Object.values(event.after)),
          };
        } else if (event.format === "middle-ground" && prompt.middleGround) {
          prompt.middleGround.summary = { sides: event.sides };
        }
        break;
      }
      case "round-ended": {
        const round = currentRound();
        if (!round) break;
        round.endedAt = event.at;
        const prompt = currentPrompt();
        if (prompt && prompt.endedAt === null) prompt.endedAt = event.at;
        break;
      }
      case "room-ended":
        endedAt = event.at;
        break;
    }
  }

  for (const personId of floorSince.keys()) endFloorTurn(personId, endedAt ?? now);

  const recapRounds: RecapRound[] = rounds.map((round) => ({
    ...round,
    prompts: round.prompts.map((prompt) => ({
      ...prompt,
      moods: promptMoodInsights(prompt.moodEvents, positionChanges(prompt), nickname),
    })),
  }));

  return {
    people: people(events, nickname),
    floorTime: [...floorMs]
      .map(([personId, ms]) => ({ personId, nickname: nickname(personId), ms }))
      .sort((a, b) => b.ms - a.ms),
    rounds: recapRounds,
    moodOverview: moodOverview(recapRounds),
    endedAt,
  };
}

/**
 * What counts as someone changing where they stand on a Prompt, for its Mood
 * links. Spectrum: each move after the reveal that ends nearest a different
 * notch from where it started (so each notch crossed, and a settle that isn't
 * mere jitter). Middle Ground: each step-in and step-back after the reveal.
 */
function positionChanges(prompt: Omit<RecapPrompt, "moods">): PositionChange[] {
  const moved: PositionChange[] = (prompt.spectrum?.moves ?? [])
    .filter((m) => m.from === null || nearestNotch(m.from) !== nearestNotch(m.to))
    .map((m) => ({ at: m.at, personId: m.personId, kind: "moved", from: m.from, to: m.to }));
  const stepped: PositionChange[] = (prompt.middleGround?.steps ?? []).map((step) => ({
    at: step.at,
    personId: step.personId,
    kind: step.steppedIn ? "stepped-in" : "stepped-back",
    side: step.side,
  }));
  return [...moved, ...stepped];
}

/** Who joined the Room and how, as the events tell it. */
function people(events: RecapEvent[], nickname: (personId: string) => string): RecapPerson[] {
  const byId = new Map<string, RecapPerson>();
  const add = (personId: string, joinedAs: RecapPerson["joinedAs"], at: number) =>
    byId.set(personId, {
      personId,
      nickname: nickname(personId),
      joinedAs,
      joinedAt: at,
      becameParticipantAt: null,
      removedAt: null,
      coHost: [],
    });
  for (const event of events) {
    switch (event.type) {
      case "room-opened":
        add(HOST_PERSON_ID, "host", event.at);
        break;
      case "person-joined":
        // Events stored before Spectators existed have no `as`: they were Participants.
        add(event.personId, event.as ?? "participant", event.at);
        break;
      case "spectator-became-participant": {
        const person = byId.get(event.personId);
        if (person) person.becameParticipantAt = event.at;
        break;
      }
      case "person-removed": {
        const person = byId.get(event.personId);
        if (person) person.removedAt = event.at;
        break;
      }
      case "co-host-granted":
      case "co-host-revoked":
      case "co-host-stepped-down":
        byId
          .get(event.personId)
          ?.coHost.push({ at: event.at, change: CO_HOST_CHANGES[event.type] });
        break;
    }
  }
  return [...byId.values()];
}

const CO_HOST_CHANGES = {
  "co-host-granted": "granted",
  "co-host-revoked": "revoked",
  "co-host-stepped-down": "stepped-down",
} as const;

/** Each person's latest nickname, as the events tell it. Removed people keep theirs. */
function nicknames(events: RecapEvent[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const event of events) {
    switch (event.type) {
      case "room-opened":
        names.set(HOST_PERSON_ID, event.hostNickname ?? "Host");
        break;
      case "person-joined":
        names.set(event.personId, event.nickname);
        break;
      case "person-renamed":
        names.set(event.personId, event.to);
        break;
    }
  }
  return names;
}
