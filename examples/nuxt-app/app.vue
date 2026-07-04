<script setup lang="ts">
const { ready, loggedIn, user, login, logout } = useAuth()
</script>

<template>
  <p v-if="!ready">Loading...</p>
  <button v-else-if="!loggedIn" @click="login()">Log in</button>
  <div v-else>
    <p>Signed in as {{ user?.sub }}</p>
    <button @click="logout()">Log out</button>
  </div>
</template>
