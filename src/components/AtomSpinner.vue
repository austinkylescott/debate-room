<template>
  <svg class="btn-spin" viewBox="0 0 20 20" aria-hidden="true">
    <ellipse
      v-for="angle in [0, 60, 120]"
      :key="angle"
      cx="10"
      cy="10"
      rx="9"
      ry="3.4"
      :transform="`rotate(${angle} 10 10)`"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
    />
  </svg>
</template>
