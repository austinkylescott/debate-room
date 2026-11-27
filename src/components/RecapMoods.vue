<script setup lang="ts">
import { type CheckInTally, type Mood, MOODS } from "../room/mood";
import type { MoodLink, PromptMoodInsights } from "../room/recap-moods";
import { notchLabel } from "../room/spectrum";

/** One Prompt's Mood insights in the Recap. Times are shown from the Prompt's start. */
const props = defineProps<{ moods: PromptMoodInsights; startedAt: number }>();

const emoji = (mood: Mood) => MOODS.find((m) => m.id === mood)?.emoji ?? mood;

function sincePrompt(at: number): string {
  const seconds = Math.max(0, Math.round((at - props.startedAt) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** "😀 2 · 😢 1 · no Mood 1", leaving out Moods nobody picked. */
function tallyText(tally: CheckInTally): string {
  const parts = MOODS.filter((m) => tally.moods[m.id] > 0).map(
    (m) => `${m.emoji} ${tally.moods[m.id]}`,
  );
  if (tally.noMood > 0) parts.push(`no Mood ${tally.noMood}`);
  return parts.join(" · ") || "nobody was asked";
}

/** What the person did after the Mood change, e.g. "moved from Disagree to Neutral". */
function didNext(link: MoodLink): string {
  const first = link.changes[0]!;
  const last = link.changes.at(-1)!;
  if (first.kind === "moved" && last.kind === "moved") {
    const from = first.from === null ? "no position" : notchLabel(first.from);
    const to = notchLabel(last.to);
    return from === to ? `moved, then came back to ${to}` : `moved from ${from} to ${to}`;
  }
  return link.changes.map(describe).join(", then ");
}

function describe(change: MoodLink["changes"][number]): string {
  if (change.kind === "moved") return `moved to ${notchLabel(change.to)}`;
  if (change.kind === "stepped-in") return "stepped into the middle";
  return `stepped back to ${change.side}`;
}
</script>

<template>
  <div v-if="moods.timelines.length > 0 || moods.checkIn" class="recap-moods small">
    <ul v-if="moods.timelines.length > 0" class="mood-timelines">
      <li v-for="timeline in moods.timelines" :key="timeline.personId">
        <span class="name" :title="timeline.nickname">{{ timeline.nickname }}</span>
        <span v-for="(change, i) in timeline.changes" :key="i" class="mood-change">
          <span v-if="i > 0" aria-hidden="true">→</span>
          <span :title="change.mood">{{ emoji(change.mood) }}</span>
          <span class="muted">{{ sincePrompt(change.at) }}</span>
        </span>
      </li>
    </ul>
    <ul v-if="moods.links.length > 0" class="moves">
      <li v-for="(link, i) in moods.links" :key="i">
        {{ link.nickname }} went {{ emoji(link.mood) }}, then {{ didNext(link) }}
      </li>
    </ul>
    <p v-if="moods.checkIn">Check-in: {{ tallyText(moods.checkIn.tally) }}</p>
  </div>
</template>
