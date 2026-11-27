<script setup lang="ts">
import QRCode from "qrcode";
import { ref, watchEffect } from "vue";
import CopyField from "./CopyField.vue";

const props = defineProps<{ url: string }>();
const qrDataUrl = ref<string | null>(null);

watchEffect(async () => {
  qrDataUrl.value = await QRCode.toDataURL(props.url, { margin: 1, width: 240 });
});
</script>

<template>
  <div class="invite dr-card dr-card--raised">
    <img v-if="qrDataUrl" class="qr" :src="qrDataUrl" alt="QR code for the invite link" />
    <CopyField label="Invite link" :value="url" />
  </div>
</template>
