// Views derived from the Recap's events: Floor time per person, and each Round
// with its Prompts, reveals, moves and summary cards. Nothing here is stored:
// it's all computed from the append-only event list, so a client can rebuild it
// from the Recap stream or a downloaded copy. Pure and dependency-free like the
// rest of the Room module.

import type { Format } from "./lineup";
import { HOST_PERSON_ID, type RecapEvent } from "./room";
import type { RevealCause } from "./round";
import { type Distribution, distribution } from "./spectrum";

export interface RecapSummary {
  /** Everyone who has had the Floor, most Floor time first. */
  floorTime: { personId: string; nickname: string; ms: number }[];
  rounds: RecapRound[];
  /** When the Host ended the Room, or null while it's Live. */
  endedAt: number | null;
}

export interface RecapRound {
  roundId: string;
  format: Format;
  startedAt: number;
  endedAt: number | null;
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
  revealed: {
    at: number;
    by: RevealCause;
    positions: { personId: string; nickname: string; position: number | null }[];
  } | null;
  /** Moves after the reveal, in order. */
  moves: { at: number; personId: string; nickname: string; from: number | null; to: number }[];
  /** The summary card: where people locked in, and where they ended up. Only once the Prompt ends. */
  summary: { before: Distribution; after: Distribution } | null;
  /**
   * The Prompt's Mood changes and its Check-in close, as recorded. Mood insights
   * (timelines, tallies, links to position changes) are built on these later.
   */
  moodEvents: MoodRecapEvent[];
}

export type MoodRecapEvent = Extract<
  RecapEvent,
  { type: "mood-changed" } | { type: "mood-check-in-closed" }
>;

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

  const rounds: RecapRound[] = [];
  let endedAt: number | null = null;
  const currentRound = () => rounds.at(-1);
  const currentPrompt = () => currentRound()?.prompts.at(-1);

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
          prompts: [],
        });
        break;
      case "prompt-started":
        currentRound()?.prompts.push({
          promptId: event.promptId,
          promptNumber: event.promptNumber,
          text: event.text,
          startedAt: event.at,
          endedAt: null,
          revealed: null,
          moves: [],
          summary: null,
          moodEvents: [],
        });
        break;
      case "mood-changed":
      case "mood-check-in-closed":
        currentPrompt()?.moodEvents.push(event);
        break;
      case "positions-revealed": {
        const prompt = currentPrompt();
        if (!prompt) break;
        prompt.revealed = {
          at: event.at,
          by: event.by,
          positions: Object.entries(event.positions).map(([personId, position]) => ({
            personId,
            nickname: nickname(personId),
            position,
          })),
        };
        break;
      }
      case "position-moved":
        currentPrompt()?.moves.push({
          at: event.at,
          personId: event.personId,
          nickname: nickname(event.personId),
          from: event.from,
          to: event.to,
        });
        break;
      case "prompt-ended": {
        const prompt = currentPrompt();
        if (!prompt) break;
        prompt.endedAt = event.at;
        prompt.summary = {
          before: distribution(Object.values(event.before)),
          after: distribution(Object.values(event.after)),
        };
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

  return {
    floorTime: [...floorMs]
      .map(([personId, ms]) => ({ personId, nickname: nickname(personId), ms }))
      .sort((a, b) => b.ms - a.ms),
    rounds,
    endedAt,
  };
}

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
