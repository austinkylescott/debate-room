// Mood insights for the Recap (./recap.ts): for each Prompt, each person's
// timeline of Mood changes, the Mood Check-in tally, and links where a Mood
// change came shortly before a position change; and across the Room, an
// overview of Moods by Prompt. Derived from the Prompt's Mood
// events and position changes, never stored. Format-agnostic: the Recap says
// what counts as a position change in each Format. Pure and dependency-free like
// the rest of the Room module.

import { type CheckInClose, type CheckInTally, type Mood, tallyCheckIn } from "./mood";
import type { MoodRecapEvent, RecapRound } from "./recap";

/** A Mood change links to the position changes that came at most this long after it. */
export const MOOD_LINK_WINDOW_MS = 30_000;

export interface PromptMoodInsights {
  /** Each person's Mood changes during the Prompt, people in the order they first set one. */
  timelines: MoodTimeline[];
  /** The Mood Check-in once it has closed, or null while it's open or before it opens. */
  checkIn: {
    at: number;
    by: CheckInClose;
    tally: CheckInTally;
    /** Each person asked, with their answer, or null for "no Mood". */
    answers: { personId: string; nickname: string; mood: Mood | null }[];
  } | null;
  /**
   * Each Mood change that someone followed with a position change within
   * {@link MOOD_LINK_WINDOW_MS} (inclusive), in the order the Mood changes came.
   */
  links: MoodLink[];
}

export interface MoodTimeline {
  personId: string;
  nickname: string;
  changes: { at: number; mood: Mood }[];
}

/** Someone changing where they stand on a Prompt, in whatever way its Format allows. */
export type PositionChange = { at: number; personId: string } & PositionChangeKind;

export type PositionChangeKind =
  /** Spectrum: one move of the slider, from where it started to where it ended up. */
  | { kind: "moved"; from: number | null; to: number }
  /** Middle Ground: stepping into the middle, or back to their Side, after the reveal. */
  | { kind: "stepped-in" | "stepped-back"; side: string };

export interface MoodLink {
  personId: string;
  nickname: string;
  mood: Mood;
  moodAt: number;
  /**
   * The person's position changes in the window, in order. A change made at the
   * same moment as a Mood change counts as after it; one made after the person's
   * next Mood change belongs to that one instead.
   */
  changes: ({ at: number } & PositionChangeKind)[];
}

export function promptMoodInsights(
  moodEvents: MoodRecapEvent[],
  positionChanges: PositionChange[],
  nickname: (personId: string) => string,
): PromptMoodInsights {
  const timelines = new Map<string, MoodTimeline>();
  let checkIn: PromptMoodInsights["checkIn"] = null;
  for (const event of moodEvents) {
    if (event.type === "mood-check-in-closed") {
      const answers = Object.entries(event.moods);
      checkIn = {
        at: event.at,
        by: event.by,
        tally: tallyCheckIn(answers.map(([, mood]) => mood)),
        answers: answers.map(([personId, mood]) => ({
          personId,
          nickname: nickname(personId),
          mood,
        })),
      };
      continue;
    }
    let timeline = timelines.get(event.personId);
    if (!timeline) {
      timeline = { personId: event.personId, nickname: nickname(event.personId), changes: [] };
      timelines.set(event.personId, timeline);
    }
    timeline.changes.push({ at: event.at, mood: event.mood });
  }

  const links: MoodLink[] = [];
  for (const event of moodEvents) {
    if (event.type !== "mood-changed") continue;
    const { personId, at: moodAt } = event;
    const next = timelines.get(personId)!.changes.find((c) => c.at > moodAt);
    const changes = positionChanges
      .filter(
        (c) =>
          c.personId === personId &&
          c.at >= moodAt &&
          c.at - moodAt <= MOOD_LINK_WINDOW_MS &&
          (next === undefined || c.at < next.at),
      )
      .map(({ personId: _personId, ...change }) => change);
    if (changes.length === 0) continue;
    links.push({ personId, nickname: nickname(personId), mood: event.mood, moodAt, changes });
  }

  return { timelines: [...timelines.values()], checkIn, links };
}

/** One Prompt's Moods at a glance, for the Room-wide overview. */
export interface MoodOverviewEntry {
  /** 1-based, in the order the Rounds were played. */
  roundNumber: number;
  promptNumber: number;
  text: string;
  /** How many times someone changed to each Mood during the Prompt (Check-in answers included). */
  moodChanges: Record<Mood, number>;
  /** The Check-in tally, or null until it has closed. */
  checkIn: CheckInTally | null;
}

/** Every Prompt played in the Room, in order, with its Moods at a glance. */
export function moodOverview(rounds: RecapRound[]): MoodOverviewEntry[] {
  return rounds.flatMap((round, r) =>
    round.prompts.map((prompt) => ({
      roundNumber: r + 1,
      promptNumber: prompt.promptNumber,
      text: prompt.text,
      moodChanges: tallyCheckIn(
        prompt.moods.timelines.flatMap((timeline) => timeline.changes.map((c) => c.mood)),
      ).moods,
      checkIn: prompt.moods.checkIn?.tally ?? null,
    })),
  );
}
