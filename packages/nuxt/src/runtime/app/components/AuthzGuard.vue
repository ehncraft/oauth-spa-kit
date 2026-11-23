<template>
  <NuxtErrorBoundary @error="onRenderError">
    <template v-if="pending">
      <slot name="loading">
        <span
          class="authz-guard-spinner"
          role="status"
          aria-label="Checking permissions"
        />
      </slot>
    </template>

    <template v-else-if="!result.ok">
      <slot
        name="error"
        :error="result.error"
        :retry="refresh"
      >
        <p>
          Couldn't check your permissions.
          <button
            type="button"
            @click="refresh()"
          >
            Retry
          </button>
        </p>
      </slot>
    </template>

    <template v-else-if="authorized">
      <slot />
    </template>

    <template v-else>
      <slot name="denied">
        <p>You don't have permission to view this.</p>
      </slot>
    </template>

    <template #error="{ error, clearError }">
      <slot
        name="render-error"
        :error="error"
        :clear-error="clearError"
      >
        <p>
          Something went wrong displaying this.
          <button
            type="button"
            @click="clearError()"
          >
            Try again
          </button>
        </p>
      </slot>
    </template>
  </NuxtErrorBoundary>
</template>

<script setup lang="ts">
import { computed, useAsyncData, useId } from "#imports";
import { useCan } from "../composables/useCan";
import type { CanCheck, CanManyResult } from "../composables/useCan";

const props = withDefaults(
  defineProps<{
    permission?: CanCheck;
    permissions?: CanCheck[];
    mode?: "all" | "any";
  }>(),
  { mode: "all" },
);

defineSlots<{
  default(): unknown;
  loading(): unknown;
  denied(): unknown;
  error(props: { error: unknown; retry: () => void }): unknown;
  "render-error"(props: { error: unknown; clearError: () => void }): unknown;
}>();

if (import.meta.dev) {
  const hasOne = !!props.permission;
  const hasMany = !!props.permissions && props.permissions.length > 0;
  if (hasOne === hasMany) {
    console.warn("[AuthzGuard] supply exactly one of `permission` or `permissions`.");
  }
}

const { canManyDetailed } = useCan();

const checks = computed<CanCheck[]>(() => (props.permissions?.length ? props.permissions : props.permission ? [props.permission] : []));

const instanceKey = `authz-guard-${useId()}`;

const { data: result, pending, refresh } = useAsyncData<CanManyResult>(
  instanceKey,
  async () => {
    if (checks.value.length === 0) {
      return { decisions: [], ok: false, error: new Error("AuthzGuard requires `permission` or `permissions`.") };
    }
    return canManyDetailed(checks.value);
  },
  { watch: [checks], default: () => ({ decisions: [], ok: true }) },
);

const authorized = computed(() => {
  const decisions = result.value?.decisions ?? [];
  if (decisions.length === 0) return false;
  return props.mode === "any" ? decisions.some(Boolean) : decisions.every(Boolean);
});

function onRenderError(error: unknown) {
  console.error("[AuthzGuard] caught a render error", error);
}
</script>

<style scoped>
.authz-guard-spinner {
  display: inline-block;
  width: 1em;
  height: 1em;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: authz-guard-spin 0.6s linear infinite;
}

@keyframes authz-guard-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
