<script setup lang="ts">
import { ref } from "vue";
import { NICKNAME_MAX_LENGTH, type WaitingRoomPerson } from "../room/room";

const props = defineProps<{
  people: WaitingRoomPerson[];
  youId: string;
  /** Rename and remove: the Host and Co-Hosts. */
  canManage?: boolean;
  /** Make and revoke Co-Hosts, and remove them: the Host only. */
  isHost?: boolean;
  /** Spectators can't be Co-Hosts. */
  canBeCoHosts?: boolean;
}>();
const emit = defineEmits<{
  rename: [personId: string, nickname: string];
  remove: [personId: string];
  grant: [personId: string];
  revoke: [personId: string];
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

/** Only the Host removes a Co-Host; nobody removes the Host. */
const canRemove = (person: WaitingRoomPerson) =>
  !person.isHost && (!person.isCoHost || props.isHost);
</script>

<template>
  <ul class="people waiting-room">
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
        <span class="name" :title="person.nickname">{{ person.nickname }}</span>
        <span v-if="person.isHost" class="dr-tag dr-tag--host">
          <svg viewBox="0 0 14 14" aria-hidden="true">
            <path d="M1,11 L2,4 L5,7 L7,2 L9,7 L12,4 L13,11Z" />
          </svg>
          Host
        </span>
        <span v-if="person.isCoHost" class="dr-tag dr-tag--cohost">Co-Host</span>
        <span v-if="person.id === youId" class="dr-tag">You</span>
        <span v-if="canManage" class="actions">
          <button type="button" class="link" @click="startRename(person)">Rename</button>
          <template v-if="isHost && canBeCoHosts && !person.isHost">
            <button
              v-if="person.isCoHost"
              type="button"
              class="link"
              @click="emit('revoke', person.id)"
            >
              Revoke Co-Host
            </button>
            <button v-else type="button" class="link" @click="emit('grant', person.id)">
              Make Co-Host
            </button>
          </template>
          <button
            v-if="canRemove(person)"
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
