import { defineNuxtPlugin } from "#imports";
import { useAuth } from "../composables/useAuth";

export default defineNuxtPlugin(async () => {
  await useAuth().refresh();
});
