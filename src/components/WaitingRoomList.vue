<script setup lang="ts">
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@ui-sdk/vue/menu";
import { nextTick, ref } from "vue";
import { ask } from "../lib/ask";
import { useMenuPresentation } from "../lib/mediaQuery";
import { NICKNAME_MAX_LENGTH, type WaitingRoomPerson } from "../room/room";
import Electron from "./Electron.vue";

const props = defineProps<{
  people: WaitingRoomPerson[];
  youId: string;
  /** Rename and remove: the Host and Co-Hosts. */
  canManage?: boolean;
  /** Make and revoke Co-Hosts, and remove them: the Host only. */
  isHost?: boolean;
  /** Spectators can't be Co-Hosts. */
  canBeCoHosts?: boolean;
  /** This is the Spectators' list: their electrons sit on the dashed outer shell. */
  spectators?: boolean;
}>();
const emit = defineEmits<{
  rename: [personId: string, nickname: string];
  remove: [personId: string];
  grant: [personId: string];
  revoke: [personId: string];
}>();

const editingId = ref<string | null>(null);
const draft = ref("");
const renameInput = ref<HTMLInputElement[]>([]);
const presentation = useMenuPresentation();

async function startRename(person: WaitingRoomPerson) {
  editingId.value = person.id;
  draft.value = person.nickname;
  // The menu's trigger is gone once the row turns into the form: focus goes to the field.
  await nextTick();
  renameInput.value[0]?.focus();
}

function saveRename(personId: string) {
  emit("rename", personId, draft.value);
  editingId.value = null;
}

async function confirmRemove(person: WaitingRoomPerson) {
  const yes = await ask({
    title: `Remove ${person.nickname}?`,
    description: "They leave the Room and can't join it again.",
    confirmLabel: "Remove from Room",
  });
  if (yes) emit("remove", person.id);
}

// Renaming and removing wait until the menu has closed and handed focus back, so the
// rename field or the dialog takes focus after it rather than having it taken away.
let afterClose: (() => void) | null = null;

function act(person: WaitingRoomPerson, action: unknown) {
  if (action === "rename") afterClose = () => void startRename(person);
  else if (action === "remove") afterClose = () => void confirmRemove(person);
  else if (action === "grant") emit("grant", person.id);
  else if (action === "revoke") emit("revoke", person.id);
}

function onMenuSettled(open: boolean) {
  if (open) return;
  const next = afterClose;
  afterClose = null;
  next?.();
}

/** Make or revoke Co-Host: the Host only, and never for the Host or a Spectator. */
const canCoHost = (person: WaitingRoomPerson) =>
  Boolean(props.isHost && props.canBeCoHosts && !person.isHost);

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
          ref="renameInput"
          v-model="draft"
          :aria-label="`New nickname for ${person.nickname}`"
          :maxlength="NICKNAME_MAX_LENGTH"
          required
        />
        <button type="submit">Save</button>
        <button type="button" @click="editingId = null">Cancel</button>
      </form>
      <template v-else>
        <!-- The Host and Co-Host tags say the role in words, so no role badge on the disc. -->
        <Electron :name="person.nickname" layout="row" :spectator="spectators" />
        <span v-if="person.isHost" class="dr-tag dr-tag--host">
          <svg viewBox="0 0 14 14" aria-hidden="true">
            <path d="M1,11 L2,4 L5,7 L7,2 L9,7 L12,4 L13,11Z" />
          </svg>
          Host
        </span>
        <span v-if="person.isCoHost" class="dr-tag dr-tag--cohost">Co-Host</span>
        <span v-if="person.id === youId" class="dr-tag dr-tag--outline">You</span>
        <Menu
          v-if="canManage"
          :presentation="presentation"
          @action="(value: unknown) => act(person, value)"
          @open-change-complete="onMenuSettled"
        >
          <MenuTrigger class="dr-menu-trigger" :aria-label="`Actions for ${person.nickname}`">
            <span aria-hidden="true">⋯</span>
          </MenuTrigger>
          <MenuContent class="dr-menu">
            <MenuItem class="dr-menu__item" value="rename">Rename…</MenuItem>
            <template v-if="canCoHost(person)">
              <MenuItem v-if="person.isCoHost" class="dr-menu__item" value="revoke">
                Revoke Co-Host
              </MenuItem>
              <MenuItem v-else class="dr-menu__item" value="grant">Make Co-Host</MenuItem>
            </template>
            <template v-if="canRemove(person)">
              <MenuSeparator class="dr-menu__sep" />
              <MenuItem class="dr-menu__item dr-menu__item--danger" value="remove">
                Remove from Room
              </MenuItem>
            </template>
          </MenuContent>
        </Menu>
      </template>
    </li>
  </ul>
</template>
