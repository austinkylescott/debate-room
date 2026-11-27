<script setup lang="ts">
import { ref } from "vue";
import AtomSpinner from "../components/AtomSpinner.vue";
import CopyField from "../components/CopyField.vue";
import NicknameField from "../components/NicknameField.vue";
import Notice from "../components/Notice.vue";
import ParticipantLimitField from "../components/ParticipantLimitField.vue";
import PinField from "../components/PinField.vue";
import { saveHostSecret } from "../lib/device";
import { type RejectedField, rejectedField } from "../lib/rejectedField";
import { hostUrl, navigate, roomPath } from "../lib/route";
import type { CreateRoomRequest, CreateRoomResponse } from "../room/protocol";
import { DEFAULT_PARTICIPANT_LIMIT, PIN_MAX_LENGTH, PIN_MIN_LENGTH } from "../room/room";

const hostNickname = ref("");
const pin = ref("");
const participantLimit = ref(DEFAULT_PARTICIPANT_LIMIT);
const creating = ref(false);
const error = ref<string | null>(null);
/** The field the error is about, which shows it; otherwise it shows under the form. */
const errorField = ref<RejectedField | null>(null);
const fieldError = (field: RejectedField) => (errorField.value === field ? error.value : null);
const created = ref<{ roomId: string; hostLink: string } | null>(null);

async function createRoom() {
  creating.value = true;
  error.value = null;
  errorField.value = null;
  try {
    const response = await fetch("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        hostNickname: hostNickname.value,
        pin: pin.value,
        participantLimit: participantLimit.value,
      } satisfies CreateRoomRequest),
    });
    const result = (await response.json()) as CreateRoomResponse;
    if (!result.ok) {
      error.value = result.message;
      errorField.value = rejectedField(result.code);
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
    <Notice tone="warning" role="alert">
      <strong>Save this Host link now.</strong> It's shown only once. It gets you back in as the
      Host on any device, so keep it private. If you lose it, open the invite link, choose "I'm the
      Host" and enter your PIN.
    </Notice>
    <CopyField label="Host link" :value="created.hostLink" />
    <button class="primary" type="button" @click="navigate(roomPath(created.roomId))">
      I've saved it, go to my Room
    </button>
  </section>

  <section v-else class="card">
    <h1>Debate Room</h1>
    <p class="lede">Stage a discussion night with your friends, alongside your own call.</p>
    <form class="stack" @submit.prevent="createRoom">
      <NicknameField v-model="hostNickname" :error="fieldError('nickname')" />
      <PinField
        v-model="pin"
        :help="`${PIN_MIN_LENGTH} to ${PIN_MAX_LENGTH} digits. With your PIN you can take back Host control from the invite link on any device.`"
        :error="fieldError('pin')"
      />
      <ParticipantLimitField v-model="participantLimit" :error="fieldError('limit')" />
      <p v-if="error && !errorField" class="error" role="alert">{{ error }}</p>
      <button class="primary" type="submit" :disabled="creating" :aria-busy="creating">
        <AtomSpinner v-if="creating" />
        {{ creating ? "Creating…" : "Create a Room" }}
      </button>
    </form>
  </section>
</template>
