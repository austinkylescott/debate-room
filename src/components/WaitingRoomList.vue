<script setup lang="ts">
import type { WaitingRoomPerson } from "../room/room";

defineProps<{ people: WaitingRoomPerson[]; youId: string }>();
</script>

<template>
  <ul class="people">
    <li v-for="person in people" :key="person.id" :class="{ you: person.id === youId }">
      <span class="name">{{ person.nickname }}</span>
      <span v-if="person.isHost" class="tag">Host</span>
      <span v-if="person.id === youId" class="tag subtle">You</span>
    </li>
  </ul>
</template>
