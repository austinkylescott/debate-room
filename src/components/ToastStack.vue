<script setup lang="ts">
// The toasts, hanging from the top of the screen on a string (Toast.md). Mounted
// once, in App.vue. At most two show; the rest wait their turn.
import { Toast, ToastAction, ToastClose, ToastRegion, ToastTitle } from "@ui-sdk/vue/toast";
import { toaster, type ToastExtras } from "../lib/toasts";
import StatusIcon from "./StatusIcon.vue";

const extras = (data: unknown) => data as ToastExtras;
const shape = (type: string) =>
  type === "success" || type === "warning" || type === "error" ? type : "info";
</script>

<template>
  <ToastRegion
    class="dr-toasts"
    :toaster="toaster"
    side="top"
    align="center"
    :max-visible="2"
    expanded
  >
    <template #default="{ toast: item }">
      <Toast class="dr-toast">
        <StatusIcon :type="shape(item.type)" />
        <ToastTitle class="dr-toast__message">
          <template v-if="extras(item.data).name"
            ><b class="dr-toast__name" :title="extras(item.data).name">{{
              extras(item.data).name
            }}</b
            >{{ String(item.title).slice(extras(item.data).name!.length) }}</template
          >
        </ToastTitle>
        <ToastAction v-if="item.action" class="dr-toast__button" />
        <ToastClose v-else-if="item.dismissible" class="dr-toast__button">
          {{ extras(item.data).close }}
        </ToastClose>
      </Toast>
    </template>
  </ToastRegion>
</template>
