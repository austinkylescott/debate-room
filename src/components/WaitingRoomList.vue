<script setup lang="ts">
import { ref } from "vue";
import { NICKNAME_MAX_LENGTH, type WaitingRoomPerson } from "../room/room";

defineProps<{ people: WaitingRoomPerson[]; youId: string; canManage?: boolean }>();
const emit = defineEmits<{
  rename: [personId: string, nickname: string];
  remove: [personId: string];
}>();

const editingId = ref<string | null>(null);
const draft = ref("");

function startRename(person: WaitingRoomPerson) {
  editingId.value = person.id;
  draft.value = person.nickname;
}

function saveRename(personId: string) {
  emit("rename", personId, draft.value);
  editingId.value = null;
}

function confirmRemove(person: WaitingRoomPerson) {
  if (confirm(`Remove ${person.nickname} from the Room? They won't be able to join again.`)) {
    emit("remove", person.id);
  }
}
</script>

<template>
  <ul class="people">
    <li v-for="person in people" :key="person.id" :class="{ you: person.id === youId }">
      <form
        v-if="editingId === person.id"
        class="rename-row"
        @submit.prevent="saveRename(person.id)"
      >
        <input
          v-model="draft"
          :aria-label="`New nickname for ${person.nickname}`"
          :maxlength="NICKNAME_MAX_LENGTH"
          required
        />
        <button type="submit">Save</button>
        <button type="button" @click="editingId = null">Cancel</button>
      </form>
      <template v-else>
        <span class="name">{{ person.nickname }}</span>
        <span v-if="person.isHost" class="tag">Host</span>
        <span v-if="person.id === youId" class="tag subtle">You</span>
        <span v-if="canManage" class="actions">
          <button type="button" class="link" @click="startRename(person)">Rename</button>
          <button
            v-if="!person.isHost"
            type="button"
            class="link danger"
            @click="confirmRemove(person)"
          >
            Remove
          </button>
        </span>
      </template>
    </li>
  </ul>
</template>
