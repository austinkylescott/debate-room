<script setup lang="ts">
import { ref } from "vue";
import CopyField from "../components/CopyField.vue";
import { saveHostSecret } from "../lib/device";
import { hostUrl, navigate, roomPath } from "../lib/route";
import type { CreateRoomResponse } from "../room/protocol";
import { NICKNAME_MAX_LENGTH } from "../room/room";

const hostNickname = ref("");
const creating = ref(false);
const error = ref<string | null>(null);
const created = ref<{ roomId: string; hostLink: string } | null>(null);

async function createRoom() {
  creating.value = true;
  error.value = null;
  try {
    const response = await fetch("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hostNickname: hostNickname.value }),
    });
    const result = (await response.json()) as CreateRoomResponse;
    if (!result.ok) {
      error.value = result.message;
      return;
    }
    saveHostSecret(result.roomId, result.hostSecret);
    created.value = { roomId: result.roomId, hostLink: hostUrl(result.roomId, result.hostSecret) };
  } catch {
    error.value = "Couldn't create the Room. Check your connection and try again.";
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <section v-if="created" class="card">
    <h1>Your Room is ready</h1>
    <p class="warning" role="alert">
      <strong>Save this Host link now.</strong> It's shown only once. It gets you back in as the
      Host on any device, so keep it private.
    </p>
    <CopyField label="Host link" :value="created.hostLink" />
    <button class="primary" type="button" @click="navigate(roomPath(created.roomId))">
      I've saved it, go to my Room
    </button>
  </section>

  <section v-else class="card">
    <h1>Debate Room</h1>
    <p class="lede">Stage a discussion night with your friends, alongside your own call.</p>
    <form class="stack" @submit.prevent="createRoom">
      <label class="field">
        <span>Your nickname</span>
        <input
          v-model="hostNickname"
          autocomplete="nickname"
          :maxlength="NICKNAME_MAX_LENGTH"
          required
        />
      </label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <button class="primary" type="submit" :disabled="creating">
        {{ creating ? "Creating…" : "Create a Room" }}
      </button>
    </form>
  </section>
</template>
