<script setup lang="ts">
// A button that opens one of the example studies as a demo (ADR 78). The join page wants an ID,
// as it would from a recruitment site, so this makes one up and nobody has to type anything.
import { onMounted, ref } from "vue";

const props = defineProps<{ study: string; name: string }>();
const DEMOS = "https://clikbrite.com";
const address = ref(`${DEMOS}/join/try-${props.study}`);

onMounted(() => {
  // Made up in the browser, so each visitor gets a world of their own. Without it, as when
  // scripts are off, the join page asks for an ID and takes anything.
  const id = `demo-${Math.random().toString(36).slice(2, 10)}`;
  address.value = `${DEMOS}/join/try-${props.study}?PROLIFIC_PID=${id}`;
});
</script>

<template>
  <div class="try-it">
    <a class="try-it-button" :href="address" target="_blank" rel="noopener">Try {{ name }} →</a>
    <p>
      Opens the study as a participant would see it, in a new tab. It's a demo: everyone in it is
      made up, nothing you do is used for research, and you're put in one of its conditions at
      random. It works best on a phone.
    </p>
  </div>
</template>

<style scoped>
.try-it {
  margin: 1.5rem 0;
  padding: 1rem 1.25rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
}
.try-it-button {
  display: inline-block;
  padding: 0.6rem 1.2rem;
  border-radius: 999px;
  background: var(--vp-c-brand-1);
  color: var(--vp-c-white);
  font-weight: 600;
  text-decoration: none;
}
.try-it-button:hover {
  background: var(--vp-c-brand-2);
}
.try-it p {
  margin: 0.75rem 0 0;
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
}
</style>
