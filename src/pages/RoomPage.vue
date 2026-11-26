<script setup lang="ts">
import { computed, ref, watch } from "vue";
import FloorPanel from "../components/FloorPanel.vue";
import InviteCard from "../components/InviteCard.vue";
import LineupEditor from "../components/LineupEditor.vue";
import LineupPreview from "../components/LineupPreview.vue";
import NicknameField from "../components/NicknameField.vue";
import ParticipantLimitField from "../components/ParticipantLimitField.vue";
import PinField from "../components/PinField.vue";
import RecapPanel from "../components/RecapPanel.vue";
import SpectrumStage from "../components/SpectrumStage.vue";
import WaitingRoomList from "../components/WaitingRoomList.vue";
import { inviteUrl, navigate } from "../lib/route";
import { useRoom } from "../lib/useRoom";
import { FORMAT_NAMES } from "../room/lineup";
import { DEFAULT_PARTICIPANT_LIMIT } from "../room/room";

const props = defineProps<{ roomId: string }>();
const { view, rejection, status, recap, send } = useRoom(props.roomId);

const nickname = ref("");
const pin = ref("");
const hostFormOpen = ref(false);
const limitDraft = ref(DEFAULT_PARTICIPANT_LIMIT);
const hostPlaying = ref(false);

const you = computed(() => view.value?.you);
const personId = computed(() => (you.value && "personId" in you.value ? you.value.personId : ""));
const isFull = computed(() => {
  const capacity = view.value?.capacity;
  return capacity !== undefined && capacity.joined >= capacity.limit;
});
const nextRound = computed(() => {
  const id = view.value?.nextRoundId;
  if (!id) return null;
  const index = view.value?.lineup?.findIndex((r) => r.id === id) ?? -1;
  const round = view.value?.lineup?.[index];
  return round ? { round, number: index + 1 } : null;
});
// Visitors see refusals next to the form they just used; everyone else in a card.
const rejectionInline = computed(
  () => you.value?.role === "visitor" && (hostFormOpen.value || view.value?.phase === "live"),
);

watch(
  () => view.value?.capacity.limit,
  (limit) => {
    if (limit !== undefined) limitDraft.value = limit;
  },
  { immediate: true },
);

const expiresOn = computed(() =>
  view.value
    ? new Date(view.value.expiresAt).toLocaleDateString(undefined, { dateStyle: "long" })
    : "",
);

function endRoom() {
  if (confirm("End the Room for everyone? Nobody can join or play after this. The Recap stays.")) {
    send({ type: "end-room" });
  }
}

function claimHostWithPin() {
  send({ type: "claim-host-pin", pin: pin.value });
  pin.value = "";
}
</script>

<template>
  <section v-if="status === 'missing'" class="card">
    <h1>Room not found</h1>
    <p>
      This invite link doesn't match a Room. Check the link and try again. Rooms expire after 7 days
      without activity.
    </p>
    <p><a href="/" @click.prevent="navigate('/')">Create a Room</a></p>
  </section>

  <section v-else-if="status === 'removed' || view?.you.role === 'removed'" class="card">
    <h1>You were removed from this Room</h1>
    <p>The Host removed you, so you can't rejoin from this device.</p>
  </section>

  <section v-else-if="!view" class="card">
    <p class="muted">Connecting to the Room…</p>
  </section>

  <template v-else>
    <p v-if="status === 'connecting'" class="banner">Reconnecting…</p>

    <!-- Ended: everyone, whatever their role, sees the Recap -->
    <template v-if="view.phase === 'ended'">
      <section class="card">
        <p class="eyebrow">Ended</p>
        <h1>This Room has ended</h1>
        <p>The Recap stays here until {{ expiresOn }}. Download it to keep it.</p>
        <p v-if="view.you.role === 'visitor' && !hostFormOpen">
          <button type="button" class="link" @click="hostFormOpen = true">I'm the Host</button>
        </p>
        <form
          v-if="view.you.role === 'visitor' && hostFormOpen"
          class="stack"
          @submit.prevent="claimHostWithPin"
        >
          <PinField v-model="pin" label="Your Host PIN" />
          <p v-if="rejection" class="error" role="alert">{{ rejection.message }}</p>
          <button class="primary" type="submit">Continue as the Host</button>
          <button type="button" @click="hostFormOpen = false">Back</button>
        </form>
      </section>
      <RecapPanel v-if="recap" :room-id="roomId" :events="recap" />
    </template>

    <!-- Host -->
    <template v-else-if="view.you.role === 'host'">
      <section v-if="view.phase === 'planning'" class="card">
        <p class="eyebrow">Planning</p>
        <h1>Your Room isn't open yet</h1>
        <p>Open it when you're ready for people to join.</p>
        <button class="primary" type="button" @click="send({ type: 'open-room' })">
          Open the Room
        </button>
      </section>
      <template v-else>
        <SpectrumStage v-if="view.stage" :stage="view.stage" is-host @send="send" />
        <section v-else-if="view.phase === 'live'" class="card">
          <p class="eyebrow">Waiting Room</p>
          <template v-if="nextRound">
            <h1>Up next: Round {{ nextRound.number }}</h1>
            <p>
              {{ FORMAT_NAMES[nextRound.round.setup.format] }} ·
              {{ nextRound.round.prompts.length }}
              {{ nextRound.round.prompts.length === 1 ? "Prompt" : "Prompts" }}
            </p>
            <form class="stack" @submit.prevent="send({ type: 'start-round', hostPlaying })">
              <label class="check">
                <input v-model="hostPlaying" type="checkbox" />
                I'm Playing this Round
              </label>
              <p class="muted small">
                If you're not Playing, you'll see where people are leaning before the reveal.
              </p>
              <button class="primary" type="submit">Start the Round</button>
            </form>
          </template>
          <template v-else>
            <h1>No Rounds left to play</h1>
            <p class="muted">Add a Round to the Lineup to keep going.</p>
          </template>
        </section>
        <FloorPanel
          v-if="view.floor"
          :floor="view.floor"
          :people="view.waitingRoom?.people ?? []"
          :you-id="personId"
          is-host
          @send="send"
        />
        <section class="card">
          <p class="eyebrow">Live</p>
          <h2>Invite your friends</h2>
          <InviteCard :url="inviteUrl(roomId)" />
        </section>
      </template>

      <LineupEditor
        v-if="view.lineup"
        :rounds="view.lineup"
        :people="view.waitingRoom?.people ?? []"
        @send="send"
      />

      <section class="card">
        <h2>Room settings</h2>
        <form
          class="inline-form"
          @submit.prevent="send({ type: 'set-participant-limit', limit: limitDraft })"
        >
          <ParticipantLimitField v-model="limitDraft" />
          <button type="submit" :disabled="limitDraft === view.capacity.limit">Save</button>
        </form>
        <p v-if="view.phase === 'live'">
          <button type="button" class="danger" @click="endRoom">End the Room</button>
        </p>
      </section>
    </template>

    <!-- Participant: the Stage, while a Round is being played, and the Floor -->
    <template v-else-if="view.you.role === 'participant'">
      <SpectrumStage v-if="view.stage" :stage="view.stage" :is-host="false" @send="send" />
      <FloorPanel
        v-if="view.floor"
        :floor="view.floor"
        :people="view.waitingRoom?.people ?? []"
        :you-id="personId"
        :is-host="false"
        @send="send"
      />
    </template>

    <!-- Visitor: not in the Room yet -->
    <section v-else-if="view.you.role === 'visitor'" class="card">
      <template v-if="hostFormOpen">
        <h1>Take back Host control</h1>
        <form class="stack" @submit.prevent="claimHostWithPin">
          <PinField v-model="pin" label="Your Host PIN" />
          <p v-if="rejection" class="error" role="alert">{{ rejection.message }}</p>
          <button class="primary" type="submit">Continue as the Host</button>
          <button type="button" @click="hostFormOpen = false">Back</button>
        </form>
      </template>
      <template v-else-if="view.phase === 'planning'">
        <p class="eyebrow">Planning</p>
        <h1>This Room isn't open yet</h1>
        <p>
          The Host is still getting things ready. Keep this page open: you can join here as soon as
          the Room opens.
        </p>
        <LineupPreview v-if="view.preview" :rounds="view.preview" />
      </template>
      <template v-else-if="view.phase === 'live'">
        <h1>Join the Room</h1>
        <p class="muted">{{ view.capacity.joined }} of {{ view.capacity.limit }} joined</p>
        <p v-if="isFull" class="warning">This Room is full right now.</p>
        <form class="stack" @submit.prevent="send({ type: 'join', nickname })">
          <NicknameField v-model="nickname" />
          <p v-if="rejection" class="error" role="alert">{{ rejection.message }}</p>
          <button class="primary" type="submit">Join</button>
        </form>
      </template>

      <p v-if="!hostFormOpen">
        <button type="button" class="link" @click="hostFormOpen = true">I'm the Host</button>
      </p>
    </section>

    <p
      v-if="rejection && !rejectionInline && view.phase !== 'ended'"
      class="error card"
      role="alert"
    >
      {{ rejection.message }}
    </p>

    <!-- Waiting Room, for everyone in the Room -->
    <section v-if="view.waitingRoom && view.phase !== 'ended'" class="card">
      <h2>
        Waiting Room
        <span class="count">{{ view.capacity.joined }} of {{ view.capacity.limit }} joined</span>
      </h2>
      <WaitingRoomList
        :people="view.waitingRoom.people"
        :you-id="personId"
        :can-manage="view.you.role === 'host'"
        @rename="
          (id, newNickname) => send({ type: 'rename-person', personId: id, nickname: newNickname })
        "
        @remove="(id) => send({ type: 'remove-person', personId: id })"
      />
      <p v-if="view.you.role === 'participant' && !view.stage" class="muted">
        You're in. The Host will start the first Round soon.
      </p>
    </section>

    <!-- The live Recap, for everyone in the Room -->
    <details v-if="view.phase === 'live' && recap" class="recap-toggle">
      <summary>Recap so far</summary>
      <RecapPanel :room-id="roomId" :events="recap" />
    </details>
  </template>
</template>
