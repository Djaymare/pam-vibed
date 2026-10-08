<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 20 });
const paths: Record<string, string> = {
  mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8',
  apps: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM9 3l1-1h4l1 1v2l2 1 2-1 2 3v2l-2 1v2l2 1v2l-2 3-2-1-2 1v2l-1 1h-4l-1-1v-2l-2-1-2 1-2-3v-2l2-1v-2l-2-1V8l2-3 2 1 2-1V3Z',
  plus: 'M12 5v14M5 12h14', arrow: 'M5 12h14M13 6l6 6-6 6', check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12M6 18 18 6', folder: 'M3 7V5h6l2 2h10v13H3V7Z', edit: 'm16 3 5 5-12 12H4v-5L16 3ZM14 5l5 5',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  shield: 'm12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Zm-4 10 3 3 5-5',
  spark: 'm12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3 2', stop: 'M7 7h10v10H7z',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 11v6M12 7v.5', chevron: 'm9 5 7 7-7 7',
};
</script>
<template><svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name] || paths.apps" /></svg></template>
