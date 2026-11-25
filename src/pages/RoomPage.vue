<script setup lang="ts">
import { computed, ref } from "vue";
import InviteCard from "../components/InviteCard.vue";
import WaitingRoomList from "../components/WaitingRoomList.vue";
import { inviteUrl, navigate } from "../lib/route";
import { useRoom } from "../lib/useRoom";
import { NICKNAME_MAX_LENGTH } from "../room/room";

const props = defineProps<{ roomId: string }>();
const { view, rejection, status, send } = useRoom(props.roomId);

const nickname = ref("");
const you = computed(() => view.value?.you);
const personId = computed(() => (you.value && "personId" in you.value ? you.value.personId : ""));
const participantCount = computed(
  () => view.value?.waitingRoom?.people.filter((p) => !p.isHost).length ?? 0,
);
</script>

<template>
  <section v-if="status === 'missing'" class="card">
    <h1>Room not found</h1>
    <p>This invite link doesn't match a Room. It may have expired.</p>
    <p><a href="/" @click.prevent="navigate('/')">Create a Room</a></p>
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
      <section v-else class="card">
        <p class="eyebrow">Live</p>
        <h1>Invite your friends</h1>
        <InviteCard :url="inviteUrl(roomId)" />
      </section>
    </template>

    <!-- Visitor: not in the Room yet -->
    <section v-else-if="view.you.role === 'visitor'" class="card">
      <template v-if="view.phase === 'planning'">
        <p class="eyebrow">Planning</p>
        <h1>This Room isn't open yet</h1>
        <p>The Host is still getting things ready. Keep this page open or come back soon.</p>
      </template>
      <template v-else-if="view.phase === 'live'">
        <h1>Join the Room</h1>
        <form class="stack" @submit.prevent="send({ type: 'join', nickname })">
          <label class="field">
            <span>Your nickname</span>
            <input
              v-model="nickname"
              autocomplete="nickname"
              :maxlength="NICKNAME_MAX_LENGTH"
              required
            />
          </label>
          <p v-if="rejection" class="error" role="alert">{{ rejection.message }}</p>
          <button class="primary" type="submit">Join</button>
        </form>
      </template>
      <template v-else>
        <h1>This Room has ended</h1>
      </template>
    </section>

    <p
      v-if="rejection && !(view.you.role === 'visitor' && view.phase === 'live')"
      class="error card"
      role="alert"
    >
      {{ rejection.message }}
    </p>

    <!-- Waiting Room, for everyone in the Room -->
    <section v-if="view.waitingRoom" class="card">
      <h2>
        Waiting Room
        <span class="count">{{ participantCount }} joined</span>
      </h2>
      <WaitingRoomList :people="view.waitingRoom.people" :you-id="personId" />
      <p v-if="view.you.role === 'participant'" class="muted">
        You're in. The Host will start the first Round soon.
      </p>
    </section>
  </template>
</template>
