<script setup lang="ts">
// The public library (ADR 93): studies that labs on hosted Truman have published and chosen to let
// anyone see. It's read from the app when the page opens, so it's never out of date.
import { onMounted, ref } from "vue";

interface Study {
  id: string;
  title: string;
  summary: string;
  paper: string;
  license: string;
  lab: string;
  publishedAt: string;
  about: {
    kind: string;
    days: number;
    conditions: string[];
    cast: number;
    posts: number;
    comments: number;
    pictures: string[];
  };
}

const API = "https://app.truman-research.org/api/admin/public/library";
// biome-ignore lint/correctness/noUnusedVariables: used in the template, which Biome doesn't read
const KINDS: Record<string, string> = {
  classic: "Classic",
  photo: "Photo",
  shortPosts: "Short posts",
  forum: "Forum",
};
const studies = ref<Study[] | null>(null);
const failed = ref(false);

onMounted(async () => {
  try {
    const answer = await fetch(API);
    studies.value = ((await answer.json()) as { studies: Study[] }).studies;
  } catch {
    failed.value = true;
  }
});

// biome-ignore lint/correctness/noUnusedVariables: used in the template, which Biome doesn't read
const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
</script>

<template>
  <div class="library">
    <p v-if="failed">The library couldn't be loaded just now. Try again in a minute.</p>
    <p v-else-if="studies === null">Loading the library…</p>
    <p v-else-if="studies.length === 0">
      Nothing has been made public yet. When a lab publishes a study and chooses to share it with
      everyone, it shows up here.
    </p>
    <article v-for="study in studies" v-else :key="study.id" class="study">
      <header>
        <h2>{{ study.title }}</h2>
        <p class="who">{{ study.lab }} · {{ day(study.publishedAt) }}</p>
      </header>
      <p class="summary">{{ study.summary }}</p>
      <div v-if="study.about.pictures.length" class="pictures">
        <img v-for="url in study.about.pictures" :key="url" :src="url" alt="" loading="lazy" />
      </div>
      <dl>
        <div><dt>Kind of site</dt><dd>{{ KINDS[study.about.kind] ?? study.about.kind }}</dd></div>
        <div><dt>Conditions</dt><dd>{{ study.about.conditions.join(", ") }}</dd></div>
        <div>
          <dt>What's in it</dt>
          <dd>
            {{ study.about.cast }} people, {{ study.about.posts }} posts,
            {{ study.about.comments }} comments, over {{ study.about.days }}
            {{ study.about.days === 1 ? "day" : "days" }}
          </dd>
        </div>
        <div><dt>License</dt><dd>{{ study.license }}</dd></div>
        <div v-if="study.paper" class="wide"><dt>Paper</dt><dd>{{ study.paper }}</dd></div>
      </dl>
      <p class="get">
        <a :href="`${API}/${study.id}/bundle`">Download the replication bundle</a>
      </p>
    </article>
  </div>
</template>

<style scoped>
.library {
  margin-top: 1.5rem;
}
.study {
  margin: 1.5rem 0;
  padding: 1.25rem 1.5rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
}
.study h2 {
  margin: 0;
  padding: 0;
  border: 0;
  font-size: 1.3rem;
}
.who {
  margin: 0.2rem 0 0;
  color: var(--vp-c-text-2);
  font-size: 0.9rem;
}
.summary {
  white-space: pre-wrap;
}
.pictures {
  display: flex;
  gap: 0.4rem;
}
.pictures img {
  width: 4.5rem;
  height: 4.5rem;
  border-radius: 6px;
  object-fit: cover;
}
dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem 1.5rem;
  margin: 1rem 0;
}
dl .wide {
  grid-column: 1 / -1;
}
dt {
  color: var(--vp-c-text-2);
  font-size: 0.8rem;
  font-weight: 600;
}
dd {
  margin: 0;
}
.get {
  margin-bottom: 0;
}
</style>
