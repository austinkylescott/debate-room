<script setup lang="ts">
import { watchEffect } from "vue";
import ThemeToggle from "./components/ThemeToggle.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import ToastStack from "./components/ToastStack.vue";
import { saveHostSecret } from "./lib/device";
import { navigate, roomPath, route } from "./lib/route";
import HomePage from "./pages/HomePage.vue";
import RoomPage from "./pages/RoomPage.vue";

// The Host link carries the Host secret in its fragment. Remember it on this
// device, then drop it from the address bar so it isn't shared by accident.
watchEffect(() => {
  const current = route.value;
  if (current.name !== "host-link") return;
  if (current.hostSecret) saveHostSecret(current.roomId, current.hostSecret);
  navigate(roomPath(current.roomId), { replace: true });
});
</script>

<template>
  <header class="app-bar">
    <ThemeToggle />
  </header>
  <main class="shell">
    <HomePage v-if="route.name === 'home'" />
    <RoomPage v-else-if="route.name === 'room'" :key="route.roomId" :room-id="route.roomId" />
    <section v-else class="card">
      <h1>Page not found</h1>
      <p><a href="/" @click.prevent="navigate('/')">Create a Room</a></p>
    </section>
  </main>
  <ToastStack />
  <ConfirmDialog />
</template>
