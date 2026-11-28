<script setup lang="ts">
// The one dialog every `ask()` question uses (lib/ask.ts): UI SDK's AlertDialog, styled
// like a card. The agreeing answer is destructive here, so it's the spicy outline,
// never the spark (hard rule 2); Cancel is the plain secondary button.
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  createConfirm,
} from "@ui-sdk/vue/alert-dialog";
import { onBeforeUnmount } from "vue";
import { type Question, registerAsker } from "../lib/ask";

const confirm = createConfirm<Question>();
const QuestionContent = AlertDialogContent<Question>;
onBeforeUnmount(registerAsker((question) => confirm(question)));
</script>

<template>
  <AlertDialog :controller="confirm.controller">
    <AlertDialogBackdrop class="dr-dialog__backdrop" />
    <QuestionContent v-slot="{ state }" class="dr-dialog">
      <AlertDialogTitle class="dr-dialog__title">{{ state.payload?.title }}</AlertDialogTitle>
      <AlertDialogDescription class="dr-dialog__description">
        {{ state.payload?.description }}
      </AlertDialogDescription>
      <div class="dr-dialog__actions">
        <AlertDialogClose>{{ state.payload?.cancelLabel ?? "Cancel" }}</AlertDialogClose>
        <AlertDialogClose class="danger" value="confirm">
          {{ state.payload?.confirmLabel }}
        </AlertDialogClose>
      </div>
    </QuestionContent>
  </AlertDialog>
</template>
