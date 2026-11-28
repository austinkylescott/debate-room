<script setup lang="ts">
// The Spectrum after the reveal, as an orbit (AtomicStage.md): five notches on an
// arc around a turning atom, and each notch's people as electrons on a small orbit.
// Your orbit is open, with name pills; tapping another orbit opens it instead.
// Geometry lives in lib/orbit.ts. The drawing is hidden from screen readers: each
// orbit is a toggle button that names its notch, its count and its people, and
// the group of them is named with every count.
import { Toggle, ToggleGroup } from "@ui-sdk/vue/toggle";
import { computed, ref, watch } from "vue";
import { compassPoints } from "../design/shapes";
import { type FloorMarks, initials } from "../lib/electron";
import {
  ELECTRON_RADIUS,
  labelPoint,
  layoutOrbit,
  NUCLEUS,
  notchPoint,
  orbitLabel,
  orbitSummary,
  pillName,
  PILL_MAX_WIDTH,
  placePills,
  VIEW,
  CENTER,
  ARC_RADIUS,
} from "../lib/orbit";
import { MOODS, type Mood } from "../room/mood";
import { nearestNotch, SPECTRUM_NOTCHES } from "../room/spectrum";
import Electron from "./Electron.vue";

const props = defineProps<{
  people: { personId: string; nickname: string; position: number }[];
  /** You, when you're Playing: your electron follows `yourPosition`, your slider. */
  youId: string | null;
  yourPosition: number | null;
  moods: Record<string, Mood>;
  marks: (personId: string) => FloorMarks;
  /** The notch value your own move just crossed: its starburst flashes. */
  crossedNotch: number | null;
}>();

const ARC = `M${CENTER.x - ARC_RADIUS},${CENTER.y} A${ARC_RADIUS},${ARC_RADIUS} 0 0 1 ${CENTER.x + ARC_RADIUS},${CENTER.y}`;
const STAR = compassPoints();
const ATOM_ORBITS = [0, 60, 120];
/** A notch's ball starburst, 16px across. */
const BURST = Array.from({ length: 8 }, (_, i) => {
  const angle = (Math.PI * 2 * i) / 8;
  const length = i % 2 ? 5.8 : 8;
  return { x: Math.cos(angle) * length, y: Math.sin(angle) * length };
});
/** The widest an orbit's button gets, in the drawing's units, so neighbours never overlap. */
const BUTTON_MAX = 96;

const moodEmoji = (personId: string) =>
  MOODS.find((m) => m.id === props.moods[personId])?.emoji ?? null;

const yourNotch = computed(() =>
  props.youId !== null && props.yourPosition !== null ? nearestNotch(props.yourPosition) : null,
);

const groups = computed(() =>
  SPECTRUM_NOTCHES.map((_, i) =>
    props.people
      .map((person) => ({
        ...person,
        you: person.personId === props.youId,
        notch: nearestNotch(
          person.personId === props.youId && props.yourPosition !== null
            ? props.yourPosition
            : person.position,
        ),
      }))
      .filter((person) => person.notch === i),
  ),
);

const open = ref<number | null>(yourNotch.value);
watch(yourNotch, (notch) => (open.value = notch));

function onToggle(value: string[]) {
  open.value = value.length ? Number(value[0]) : null;
}

const orbits = computed(() =>
  groups.value.map((people, i) => {
    const isOpen = open.value === i;
    const layout = layoutOrbit(i, people.length, isOpen);
    const names = people.map((p) => pillName(p.nickname, p.you));
    const pills = isOpen && people.length ? placePills(layout, names) : null;
    const reach = Math.min((layout.rings.at(-1)! + ELECTRON_RADIUS) * 2, BUTTON_MAX);
    // Closed orbits bob along their own tangent, each electron a little out of step.
    const electrons = layout.seats.map((seat, j) => ({
      ...seat,
      person: people[j],
      bob: {
        "--bx": `${(Math.cos(seat.angle + Math.PI / 2) * 3).toFixed(2)}px`,
        "--by": `${(Math.sin(seat.angle + Math.PI / 2) * 3).toFixed(2)}px`,
        "--bd": `${(6 + j * 1.3).toFixed(1)}s`,
        "--bdelay": `${-j}s`,
      },
    }));
    return {
      index: i,
      label: SPECTRUM_NOTCHES[i].label,
      words: SPECTRUM_NOTCHES[i].label.split(" "),
      count: people.length,
      people,
      isOpen,
      isYours: yourNotch.value === i,
      crossed: props.crossedNotch === SPECTRUM_NOTCHES[i].value,
      layout,
      electrons,
      extra: layout.extra,
      pills: pills?.map((pill, j) => ({ ...pill, text: names[j], person: people[j] })) ?? null,
      fallback: isOpen && people.length > 0 && pills === null,
      point: notchPoint(i),
      labelAt: labelPoint(i),
      reach,
      buttonLabel: orbitLabel(
        i,
        people.map((p) => (p.you ? "You" : p.nickname)),
      ),
    };
  }),
);

const summary = computed(() =>
  orbitSummary(
    groups.value.map((g) => g.length),
    yourNotch.value,
  ),
);
const listed = computed(() => orbits.value.find((orbit) => orbit.fallback) ?? null);

const pct = (value: number, of: number) => `${((value / of) * 100).toFixed(3)}%`;
const poleClass = (notch: number) =>
  notch < 2 ? "is-disagree" : notch > 2 ? "is-agree" : "is-neutral";
</script>

<template>
  <div class="dr-orbit" :style="{ '--pill-max': pct(PILL_MAX_WIDTH, VIEW.width) }">
    <div class="dr-orbit__stage">
      <svg
        class="dr-orbit__drawing"
        :viewBox="`0 0 ${VIEW.width} ${VIEW.height}`"
        aria-hidden="true"
      >
        <path class="dr-orbit__arc" :d="ARC" />
        <g class="dr-orbit__nucleus" :style="{ transformOrigin: `${NUCLEUS.x}px ${NUCLEUS.y}px` }">
          <ellipse
            v-for="angle in ATOM_ORBITS"
            :key="angle"
            :cx="NUCLEUS.x"
            :cy="NUCLEUS.y"
            :rx="NUCLEUS.size / 2"
            :ry="NUCLEUS.size * 0.18"
            :transform="`rotate(${angle} ${NUCLEUS.x} ${NUCLEUS.y})`"
          />
          <circle :cx="NUCLEUS.x" :cy="NUCLEUS.y" :r="NUCLEUS.size / 14" />
        </g>

        <g
          v-for="orbit in orbits"
          :key="orbit.index"
          class="dr-orbit__notch"
          :class="{
            'is-open': orbit.isOpen,
            'is-yours': orbit.isYours,
            'is-crossed': orbit.crossed,
          }"
        >
          <circle
            v-for="(radius, r) in orbit.layout.rings"
            :key="r"
            class="dr-orbit__ring"
            :class="{ 'is-filled': orbit.isOpen && r === orbit.layout.rings.length - 1 }"
            :cx="orbit.point.x"
            :cy="orbit.point.y"
            :r="radius"
          />
          <polygon
            v-if="orbit.isYours"
            class="dr-orbit__star"
            :points="STAR"
            :transform="`translate(${orbit.point.x} ${orbit.point.y}) scale(0.34)`"
          />
          <g
            v-else
            class="dr-orbit__burst"
            :transform="`translate(${orbit.point.x} ${orbit.point.y})`"
          >
            <template v-for="(spoke, s) in BURST" :key="s">
              <line x1="0" y1="0" :x2="spoke.x" :y2="spoke.y" />
              <circle :cx="spoke.x" :cy="spoke.y" r="1.8" />
            </template>
            <circle r="2" />
          </g>

          <g
            v-for="electron in orbit.electrons"
            :key="electron.person.personId"
            :transform="`translate(${electron.x.toFixed(2)} ${electron.y.toFixed(2)})`"
          >
            <g
              class="dr-orbit__electron"
              :class="{ 'is-bobbing': !orbit.isOpen }"
              :style="electron.bob"
            >
              <circle
                v-if="marks(electron.person.personId).speaking"
                class="dr-orbit__speaking"
                r="19"
              />
              <circle class="dr-orbit__disc" :class="poleClass(orbit.index)" :r="ELECTRON_RADIUS" />
              <text class="dr-orbit__initials" :class="poleClass(orbit.index)" y="4">
                {{ initials(electron.person.nickname) }}
              </text>
              <text v-if="moodEmoji(electron.person.personId)" class="dr-orbit__mood" x="11" y="16">
                {{ moodEmoji(electron.person.personId) }}
              </text>
              <g v-if="marks(electron.person.personId).hand" transform="translate(-13 -12)">
                <path class="dr-orbit__hand" d="M0,-9 L6,0 L0,9 L-6,0Z" />
                <text class="dr-orbit__hand-number" y="3.5">
                  {{ marks(electron.person.personId).hand }}
                </text>
              </g>
            </g>
          </g>
          <g
            v-if="orbit.extra"
            :transform="`translate(${orbit.extra.x.toFixed(2)} ${orbit.extra.y.toFixed(2)})`"
          >
            <circle class="dr-orbit__disc is-neutral" :r="ELECTRON_RADIUS" />
            <text class="dr-orbit__initials is-neutral" y="4">+{{ orbit.layout.overflow }}</text>
          </g>

          <text
            class="dr-orbit__label"
            :x="orbit.labelAt.x.toFixed(1)"
            :y="orbit.labelAt.y.toFixed(1)"
          >
            <tspan
              v-for="(word, w) in orbit.words"
              :key="w"
              :x="orbit.labelAt.x.toFixed(1)"
              :dy="w ? 14 : 0"
            >
              {{ word
              }}<tspan v-if="w === orbit.words.length - 1" class="dr-orbit__count" dx="4">{{
                orbit.count
              }}</tspan>
            </tspan>
          </text>
        </g>
      </svg>

      <template v-for="orbit in orbits" :key="orbit.index">
        <span
          v-for="pill in orbit.pills ?? []"
          :key="pill.person.personId"
          class="dr-orbit__pill"
          aria-hidden="true"
          :title="pill.person.nickname"
          :style="{
            left: pct(pill.x, VIEW.width),
            top: pct(pill.y, VIEW.height),
          }"
        >
          {{ pill.text }}
        </span>
      </template>

      <ToggleGroup
        class="dr-orbit__buttons"
        :aria-label="summary"
        :value="open === null ? [] : [String(open)]"
        @value-change="onToggle"
      >
        <Toggle
          v-for="orbit in orbits"
          :key="orbit.index"
          class="dr-orbit__button"
          :value="String(orbit.index)"
          :aria-label="orbit.buttonLabel"
          :style="{
            left: pct(orbit.point.x, VIEW.width),
            top: pct(orbit.point.y, VIEW.height),
            width: pct(orbit.reach, VIEW.width),
          }"
        />
      </ToggleGroup>
    </div>

    <p class="dr-orbit__hint">
      Tap any orbit to see who's in it<template v-if="yourNotch !== null">
        · yours is open</template
      >
    </p>

    <!-- An open orbit too full for name pills lists its people instead -->
    <div v-if="listed" class="dr-orbit__list">
      <p class="dr-orbit__list-title">
        {{ listed.label }} <span class="dr-orbit__count">{{ listed.count }}</span>
      </p>
      <ul class="people">
        <li v-for="person in listed.people" :key="person.personId" :class="{ you: person.you }">
          <Electron
            :name="person.nickname"
            size="sm"
            layout="row"
            :pole="listed.index < 2 ? 'disagree' : listed.index > 2 ? 'agree' : null"
            :mood="moods[person.personId] ?? null"
            :you="person.you"
            v-bind="marks(person.personId)"
          />
        </li>
      </ul>
    </div>
  </div>
</template>
