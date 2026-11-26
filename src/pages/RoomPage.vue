<script setup lang="ts">
import { computed, ref, watch } from "vue";
import FloorPanel from "../components/FloorPanel.vue";
import InviteCard from "../components/InviteCard.vue";
import LineupEditor from "../components/LineupEditor.vue";
import LineupPreview from "../components/LineupPreview.vue";
import MiddleGroundStage from "../components/MiddleGroundStage.vue";
import NicknameField from "../components/NicknameField.vue";
import ParticipantLimitField from "../components/ParticipantLimitField.vue";
import PinField from "../components/PinField.vue";
import SpectrumStage from "../components/SpectrumStage.vue";
import WaitingRoomList from "../components/WaitingRoomList.vue";
import { inviteUrl, navigate } from "../lib/route";
import { useRoom } from "../lib/useRoom";
import { FORMAT_NAMES } from "../room/lineup";
import { DEFAULT_PARTICIPANT_LIMIT, type JoinRole } from "../room/room";

const props = defineProps<{ roomId: string }>();
const { view, rejection, status, send } = useRoom(props.roomId);

const nickname = ref("");
const pin = ref("");
const hostFormOpen = ref(false);
const limitDraft = ref(DEFAULT_PARTICIPANT_LIMIT);
const hostPlaying = ref(false);

const you = computed(() => view.value?.you);
const personId = computed(() => (you.value && "personId" in you.value ? you.value.personId : ""));
const isFull = (capacity: { joined: number; limit: number } | undefined) =>
  capacity !== undefined && capacity.joined >= capacity.limit;
const participantsFull = computed(() => isFull(view.value?.capacity));
const spectatorsFull = computed(() => isFull(view.value?.spectatorCapacity));
const joinAs = ref<JoinRole>("participant");
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

// A full Participant limit offers Spectator instead.
watch(
  participantsFull,
  (full) => {
    if (full) joinAs.value = "spectator";
  },
  { immediate: true },
);

function renamePerson(personId: string, newNickname: string) {
  send({ type: "rename-person", personId, nickname: newNickname });
}

function removePerson(personId: string) {
  send({ type: "remove-person", personId });
}

function claimHostWithPin() {
  send({ type: "claim-host-pin", pin: pin.value });
  pin.value = "";
}
</script>

<template>
  <section v-if="status === 'missing'" class="card">
    <h1>Room not found</h1>
    <p>This invite link doesn't match a Room. Check the link and try again.</p>
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

    <!-- Host -->
    <template v-if="view.you.role === 'host'">
      <section v-if="view.phase === 'planning'" class="card">
        <p class="eyebrow">Planning</p>
        <h1>Your Room isn't open yet</h1>
        <p>Open it when you're ready for people to join.</p>
        <button class="primary" type="button" @click="send({ type: 'open-room' })">
          Open the Room
        </button>
      </section>
      <template v-else>
        <SpectrumStage
          v-if="view.stage?.format === 'spectrum'"
          :stage="view.stage"
          is-host
          :person-id="personId"
          @send="send"
        />
        <MiddleGroundStage
          v-else-if="view.stage?.format === 'middle-ground'"
          :stage="view.stage"
          is-host
          :person-id="personId"
          @send="send"
        />
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
      </section>
    </template>

    <!-- Participant or Spectator: the Stage, while a Round is being played, and the Floor -->
    <template v-else-if="view.you.role === 'participant' || view.you.role === 'spectator'">
      <SpectrumStage
        v-if="view.stage?.format === 'spectrum'"
        :stage="view.stage"
        :is-host="false"
        :person-id="personId"
        :is-spectator="view.you.role === 'spectator'"
        @send="send"
      />
      <MiddleGroundStage
        v-else-if="view.stage?.format === 'middle-ground'"
        :stage="view.stage"
        :is-host="false"
        :person-id="personId"
        :is-spectator="view.you.role === 'spectator'"
        @send="send"
      />
      <FloorPanel
        v-if="view.floor"
        :floor="view.floor"
        :people="view.waitingRoom?.people ?? []"
        :you-id="personId"
        :is-host="false"
        :is-spectator="view.you.role === 'spectator'"
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
        <p v-if="participantsFull && spectatorsFull" class="warning">
          This Room is full right now, for Participants and Spectators.
        </p>
        <p v-else-if="participantsFull" class="warning">
          The Participant places are all taken, but you can watch as a Spectator.
        </p>
        <form class="stack" @submit.prevent="send({ type: 'join', nickname, as: joinAs })">
          <NicknameField v-model="nickname" />
          <fieldset class="join-as">
            <legend>Join as</legend>
            <ul class="choices">
              <li>
                <label>
                  <input
                    v-model="joinAs"
                    type="radio"
                    value="participant"
                    :disabled="participantsFull"
                  />
                  <span>
                    Participant
                    <span class="muted small">
                      Take part in the Rounds · {{ view.capacity.joined }} of
                      {{ view.capacity.limit }} joined
                    </span>
                  </span>
                </label>
              </li>
              <li>
                <label>
                  <input
                    v-model="joinAs"
                    type="radio"
                    value="spectator"
                    :disabled="spectatorsFull"
                  />
                  <span>
                    Spectator
                    <span class="muted small">
                      Watch the Stage · {{ view.spectatorCapacity.joined }} of
                      {{ view.spectatorCapacity.limit }} joined (Spectators have their own limit)
                    </span>
                  </span>
                </label>
              </li>
            </ul>
          </fieldset>
          <p v-if="rejection" class="error" role="alert">{{ rejection.message }}</p>
          <button class="primary" type="submit">Join</button>
        </form>
      </template>
      <template v-else>
        <h1>This Room has ended</h1>
      </template>

      <p v-if="!hostFormOpen">
        <button type="button" class="link" @click="hostFormOpen = true">I'm the Host</button>
      </p>
    </section>

    <p v-if="rejection && !rejectionInline" class="error card" role="alert">
      {{ rejection.message }}
    </p>

    <!-- Waiting Room, for everyone in the Room -->
    <section v-if="view.waitingRoom" class="card">
      <h2>
        Waiting Room
        <span class="count">{{ view.capacity.joined }} of {{ view.capacity.limit }} joined</span>
      </h2>
      <WaitingRoomList
        :people="view.waitingRoom.people"
        :you-id="personId"
        :can-manage="view.you.role === 'host'"
        @rename="renamePerson"
        @remove="removePerson"
      />
      <p v-if="view.you.role === 'participant' && !view.stage" class="muted">
        You're in. The Host will start the first Round soon.
      </p>

      <h3>
        Spectators
        <span class="count">
          {{ view.spectatorCapacity.joined }} of {{ view.spectatorCapacity.limit }}
        </span>
      </h3>
      <WaitingRoomList
        v-if="view.waitingRoom.spectators.length"
        :people="view.waitingRoom.spectators"
        :you-id="personId"
        :can-manage="view.you.role === 'host'"
        @rename="renamePerson"
        @remove="removePerson"
      />
      <p v-else class="muted small">No one is watching yet.</p>

      <template v-if="view.you.role === 'spectator'">
        <p class="muted">You're watching as a Spectator.</p>
        <template v-if="!view.stage">
          <button
            v-if="!participantsFull"
            type="button"
            @click="send({ type: 'become-participant' })"
          >
            Switch to Participant
          </button>
          <p v-else class="muted small">
            The Participant places are all taken. You can switch if one frees up.
          </p>
        </template>
        <p v-else class="muted small">You can switch to Participant once this Round is over.</p>
      </template>
    </section>
  </template>
</template>
