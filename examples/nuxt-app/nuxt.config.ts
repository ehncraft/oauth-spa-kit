export default defineNuxtConfig({
  modules: ["@oauth-spa-kit/nuxt"],
  oauthSpaKit: {
    oauth: {
      authority: process.env.OAUTH_AUTHORITY!,
      clientId: process.env.OAUTH_CLIENT_ID!,
      redirectUri: `${process.env.APP_ORIGIN}/auth/callback`,
      postLogoutRedirectUri: process.env.APP_ORIGIN,
      scope: "openid profile email offline_access",
      dpop: true,
    },
    session: {
      password: process.env.OAUTH_SESSION_PASSWORD!,
    },
  },
});
