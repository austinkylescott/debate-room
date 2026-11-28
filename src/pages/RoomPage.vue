<script setup lang="ts">
import { RadioGroup } from "@ui-sdk/vue/radio";
import { computed, ref, useId, watch } from "vue";
import ChoiceCheckbox from "../components/ChoiceCheckbox.vue";
import ChoiceRadio from "../components/ChoiceRadio.vue";
import FloorPanel from "../components/FloorPanel.vue";
import InviteCard from "../components/InviteCard.vue";
import LineupEditor from "../components/LineupEditor.vue";
import LineupPreview from "../components/LineupPreview.vue";
import Notice from "../components/Notice.vue";
import MiddleGroundStage from "../components/MiddleGroundStage.vue";
import NicknameField from "../components/NicknameField.vue";
import ParticipantLimitField from "../components/ParticipantLimitField.vue";
import HostPinForm from "../components/HostPinForm.vue";
import RecapPanel from "../components/RecapPanel.vue";
import SpectrumStage from "../components/SpectrumStage.vue";
import SurroundedStage from "../components/SurroundedStage.vue";
import WaitingRoomList from "../components/WaitingRoomList.vue";
import { forgetHostSecret } from "../lib/device";
import { rejectedField } from "../lib/rejectedField";
import { inviteUrl, navigate } from "../lib/route";
import { useRoom } from "../lib/useRoom";
import { useRoomToasts } from "../lib/useRoomToasts";
import { FORMAT_NAMES } from "../room/lineup";
import { DEFAULT_PARTICIPANT_LIMIT, type JoinRole } from "../room/room";

const props = defineProps<{ roomId: string }>();
const room = useRoom(props.roomId);
const { view, rejection, status, recap } = room;
const send = useRoomToasts(room);

const nickname = ref("");
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
/** Whether the Host is the Center of the next Round, and so has to be Playing it. */
const hostIsNextCenter = computed(() => {
  const setup = nextRound.value?.round.setup;
  return setup?.format === "surrounded" && setup.centerId === personId.value;
});
const nextRound = computed(() => {
  const id = view.value?.nextRoundId;
  if (!id) return null;
  const index = view.value?.lineup?.findIndex((r) => r.id === id) ?? -1;
  const round = view.value?.lineup?.[index];
  return round ? { round, number: index + 1 } : null;
});
const joinAsLegend = useId();
const setJoinAs = (role: string | null) => {
  if (role === "participant" || role === "spectator") joinAs.value = role;
};
/** The field a refusal is about, which shows it as its own error. */
const fieldRejected = computed(() => rejectedField(rejection.value?.code));
const fieldError = (field: "nickname" | "limit") =>
  fieldRejected.value === field ? (rejection.value?.message ?? null) : null;
// Visitors see refusals next to the form they just used, and the Host sees a refused
// Participant limit on its field; everyone else sees them in a card.
const rejectionInline = computed(
  () =>
    (you.value?.role === "visitor" && (hostFormOpen.value || view.value?.phase === "live")) ||
    (you.value?.role === "host" && fieldRejected.value === "limit"),
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

/** Nothing has happened in Planning, so cancelling discards the Room and goes home. */
function cancelRoom() {
  if (confirm("Cancel this Room? It will be deleted, along with its Lineup.")) {
    send({ type: "cancel-room" });
    forgetHostSecret(props.roomId);
    navigate("/");
  }
}

function claimHostWithPin(pin: string) {
  send({ type: "claim-host-pin", pin });
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
    <!-- Ended: everyone, whatever their role, sees the Recap -->
    <template v-if="view.phase === 'ended'">
      <section class="card">
        <p><span class="dr-tag">Ended</span></p>
        <h1>This Room has ended</h1>
        <p>The Recap stays here until {{ expiresOn }}. Download it to keep it.</p>
        <p v-if="view.you.role === 'visitor' && !hostFormOpen">
          <button type="button" class="link" @click="hostFormOpen = true">I'm the Host</button>
        </p>
        <HostPinForm
          v-if="view.you.role === 'visitor' && hostFormOpen"
          :rejection="rejection"
          @submit="claimHostWithPin"
          @back="hostFormOpen = false"
        />
      </section>
      <RecapPanel v-if="recap" :room-id="roomId" :events="recap" />
    </template>

    <!-- Host -->
    <template v-else-if="view.you.role === 'host'">
      <section v-if="view.phase === 'planning'" class="card">
        <p><span class="dr-tag">Planning</span></p>
        <h1>Your Room isn't open yet</h1>
        <p>Open it when you're ready for people to join.</p>
        <button class="primary" type="button" @click="send({ type: 'open-room' })">
          Open the Room
        </button>
        <p>
          <button type="button" class="link danger" @click="cancelRoom">Cancel the Room</button>
        </p>
      </section>
      <template v-else>
        <SpectrumStage
          v-if="view.stage?.format === 'spectrum'"
          :stage="view.stage"
          is-host
          :person-id="personId"
          :floor="view.floor"
          @send="send"
        />
        <MiddleGroundStage
          v-else-if="view.stage?.format === 'middle-ground'"
          :stage="view.stage"
          is-host
          :person-id="personId"
          :floor="view.floor"
          @send="send"
        />
        <SurroundedStage
          v-else-if="view.stage?.format === 'surrounded'"
          :stage="view.stage"
          is-host
          :person-id="personId"
          :floor="view.floor"
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
              <ChoiceCheckbox v-model:checked="hostPlaying">I'm Playing this Round</ChoiceCheckbox>
              <p v-if="hostIsNextCenter" class="muted small">
                You're this Round's Center, so you need to be Playing it.
              </p>
              <p v-else class="muted small">
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
          :moods="view.stage?.moods"
          @send="send"
        />
        <section class="card">
          <p><span class="dr-tag dr-tag--live">Live</span></p>
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
          <ParticipantLimitField v-model="limitDraft" :error="fieldError('limit')" />
          <button type="submit" :disabled="limitDraft === view.capacity.limit">Save</button>
        </form>
        <p v-if="view.phase === 'live'">
          <button type="button" class="danger" @click="endRoom">End the Room</button>
        </p>
      </section>
    </template>

    <!-- Participant or Spectator: the Stage, while a Round is being played, and the Floor -->
    <template v-else-if="view.you.role === 'participant' || view.you.role === 'spectator'">
      <!-- A Co-Host gets the controls for running Rounds -->
      <SpectrumStage
        v-if="view.stage?.format === 'spectrum'"
        :stage="view.stage"
        :is-host="view.runsRoom"
        :person-id="personId"
        :floor="view.floor"
        :is-spectator="view.you.role === 'spectator'"
        @send="send"
      />
      <MiddleGroundStage
        v-else-if="view.stage?.format === 'middle-ground'"
        :stage="view.stage"
        :is-host="view.runsRoom"
        :person-id="personId"
        :floor="view.floor"
        :is-spectator="view.you.role === 'spectator'"
        @send="send"
      />
      <SurroundedStage
        v-else-if="view.stage?.format === 'surrounded'"
        :stage="view.stage"
        :is-host="view.runsRoom"
        :person-id="personId"
        :floor="view.floor"
        :is-spectator="view.you.role === 'spectator'"
        @send="send"
      />
      <section v-else-if="view.coHost && view.phase === 'live'" class="card">
        <p class="eyebrow">Waiting Room · Co-Host</p>
        <h1 v-if="nextRound">Up next: Round {{ nextRound.number }}</h1>
        <h1 v-else>No Rounds left to play</h1>
        <p v-if="nextRound">
          {{ FORMAT_NAMES[nextRound.round.setup.format] }} · The Host starts the Round.
        </p>
        <ChoiceCheckbox
          :checked="view.coHost.playingNextRound"
          @update:checked="(playing: boolean) => send({ type: 'set-playing', playing })"
        >
          I'm Playing the next Round
        </ChoiceCheckbox>
        <p class="muted small">
          If you're not Playing, you'll see where people are leaning before the reveal.
        </p>
      </section>
      <FloorPanel
        v-if="view.floor"
        :floor="view.floor"
        :people="view.waitingRoom?.people ?? []"
        :you-id="personId"
        :is-host="view.runsRoom"
        :is-spectator="view.you.role === 'spectator'"
        :moods="view.stage?.moods"
        @send="send"
      />
      <LineupEditor
        v-if="view.lineup"
        :rounds="view.lineup"
        :people="view.waitingRoom?.people ?? []"
        @send="send"
      />
      <p v-if="view.coHost">
        <button type="button" class="link" @click="send({ type: 'step-down' })">
          Step down as Co-Host
        </button>
      </p>
    </template>

    <!-- Visitor: not in the Room yet -->
    <section v-else-if="view.you.role === 'visitor'" class="card">
      <template v-if="hostFormOpen">
        <h1>Take back Host control</h1>
        <HostPinForm
          :rejection="rejection"
          @submit="claimHostWithPin"
          @back="hostFormOpen = false"
        />
      </template>
      <template v-else-if="view.phase === 'planning'">
        <p><span class="dr-tag">Planning</span></p>
        <h1>This Room isn't open yet</h1>
        <p>
          The Host is still getting things ready. Keep this page open: you can join here as soon as
          the Room opens.
        </p>
        <LineupPreview v-if="view.preview" :rounds="view.preview" />
      </template>
      <template v-else-if="view.phase === 'live'">
        <h1>Join the Room</h1>
        <Notice v-if="participantsFull && spectatorsFull" tone="warning">
          This Room is full right now, for Participants and Spectators.
        </Notice>
        <Notice v-else-if="participantsFull" tone="warning">
          The Participant places are all taken, but you can watch as a Spectator.
        </Notice>
        <form class="stack" @submit.prevent="send({ type: 'join', nickname, as: joinAs })">
          <NicknameField v-model="nickname" :error="fieldError('nickname')" />
          <fieldset class="join-as">
            <legend :id="joinAsLegend" class="field__label">Join as</legend>
            <RadioGroup
              :value="joinAs"
              class="choices"
              :aria-labelledby="joinAsLegend"
              @value-change="setJoinAs"
            >
              <ChoiceRadio value="participant" :disabled="participantsFull">
                Participant
                <template #hint>
                  Take part in the Rounds · {{ view.capacity.joined }} of
                  {{ view.capacity.limit }} joined
                </template>
              </ChoiceRadio>
              <ChoiceRadio value="spectator" :disabled="spectatorsFull">
                Spectator
                <template #hint>
                  Watch the Stage · {{ view.spectatorCapacity.joined }} of
                  {{ view.spectatorCapacity.limit }} joined (Spectators have their own limit)
                </template>
              </ChoiceRadio>
            </RadioGroup>
          </fieldset>
          <p v-if="rejection && fieldRejected !== 'nickname'" class="error" role="alert">
            {{ rejection.message }}
          </p>
          <button class="primary" type="submit">Join</button>
        </form>
      </template>

      <p v-if="!hostFormOpen">
        <button type="button" class="link" @click="hostFormOpen = true">I'm the Host</button>
      </p>
    </section>

    <Notice
      v-if="rejection && !rejectionInline && view.phase !== 'ended'"
      tone="error"
      role="alert"
    >
      {{ rejection.message }}
    </Notice>

    <!-- Waiting Room, for everyone in the Room -->
    <section v-if="view.waitingRoom && view.phase !== 'ended'" class="card">
      <h2>
        Waiting Room
        <span class="count">{{ view.capacity.joined }} of {{ view.capacity.limit }} joined</span>
      </h2>
      <WaitingRoomList
        :people="view.waitingRoom.people"
        :you-id="personId"
        :can-manage="view.runsRoom"
        :is-host="view.you.role === 'host'"
        can-be-co-hosts
        @rename="renamePerson"
        @remove="removePerson"
        @grant="(id) => send({ type: 'grant-co-host', personIds: [id] })"
        @revoke="(id) => send({ type: 'revoke-co-host', personId: id })"
      />
      <p v-if="view.you.role === 'participant' && !view.stage && !view.coHost" class="muted">
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
        spectators
        :you-id="personId"
        :can-manage="view.runsRoom"
        :is-host="view.you.role === 'host'"
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

    <!-- The live Recap, for everyone in the Room -->
    <details v-if="view.phase === 'live' && recap" class="recap-toggle">
      <summary>Recap so far</summary>
      <RecapPanel :room-id="roomId" :events="recap" />
    </details>
  </template>
</template>
