// The look of every page but the home page, which has its own (ADR 75).
import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import TryIt from "../../components/TryIt.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    // So an example study's page can have a Try it button without importing anything.
    app.component("TryIt", TryIt);
  },
} satisfies Theme;
