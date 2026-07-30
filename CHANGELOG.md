## [2.0.6](https://github.com/ehncraft/oauth-spa-kit/compare/v2.0.5...v2.0.6) (2026-07-30)


### Bug Fixes

* **server:** send id_token_hint on logout ([e4c4254](https://github.com/ehncraft/oauth-spa-kit/commit/e4c425473ab82abc796eb8364a339e3a10ce3c54))

## [2.0.5](https://github.com/ehncraft/oauth-spa-kit/compare/v2.0.4...v2.0.5) (2026-07-30)


### Bug Fixes

* **nuxt:** log the callback handler's failure cause by default ([3f3872f](https://github.com/ehncraft/oauth-spa-kit/commit/3f3872f9527ac470221767e9c9a326cc7653c47c))
* **server:** add onCallbackError hook to surface the real callback failure cause ([31123e3](https://github.com/ehncraft/oauth-spa-kit/commit/31123e3133ad4a948c097e76c852dbda3466b2d4))

## [2.0.4](https://github.com/ehncraft/oauth-spa-kit/compare/v2.0.3...v2.0.4) (2026-07-30)


### Bug Fixes

* navigate to /auth/logout instead of fetching it ([c1640fb](https://github.com/ehncraft/oauth-spa-kit/commit/c1640fb37ff3b657e161428a6d9a8a1f90e46cce))

## [2.0.3](https://github.com/ehncraft/oauth-spa-kit/compare/v2.0.2...v2.0.3) (2026-07-28)


### Bug Fixes

* **server:** redirect off /auth/callback on failure instead of rendering inline ([56f62eb](https://github.com/ehncraft/oauth-spa-kit/commit/56f62eb4025510fee8b024a8219d6f9ff2060320)), closes [TokenExchangeError#error](https://github.com/TokenExchangeError/issues/error)

## [2.0.2](https://github.com/ehncraft/oauth-spa-kit/compare/v2.0.1...v2.0.2) (2026-07-28)


### Bug Fixes

* **core:** mint a fresh client_assertion on the use_dpop_nonce retry ([cea29c5](https://github.com/ehncraft/oauth-spa-kit/commit/cea29c5fde915462e9abca155f2500fde68d654b))

## [2.0.1](https://github.com/ehncraft/oauth-spa-kit/compare/v2.0.0...v2.0.1) (2026-07-11)


### Bug Fixes

* make the playground Docker image distroless and HTTPS only ([938a005](https://github.com/ehncraft/oauth-spa-kit/commit/938a00532fef13ab181e49d6b53eb90b26df6643))

# [2.0.0](https://github.com/ehncraft/oauth-spa-kit/compare/v1.2.0...v2.0.0) (2026-07-11)


* fix(core)!: audience the client assertion to the issuer, not the endpoint URL ([82bc6b7](https://github.com/ehncraft/oauth-spa-kit/commit/82bc6b70c402cfb231c3d863076c9d08aa331687))


### Bug Fixes

* **core:** explicitly type client assertions as client-authentication+jwt ([badd87e](https://github.com/ehncraft/oauth-spa-kit/commit/badd87eed9febe87d5daf221170811838dbff23c))


### BREAKING CHANGES

* exchangeAuthorizationCode and exchangeRefreshToken
(@oauth-spa-kit/core) now require an explicit assertionAudience argument,
matching pushAuthorizationRequest's existing shape, instead of silently
defaulting to tokenEndpoint. Callers using @oauth-spa-kit/server's
handlers (including @oauth-spa-kit/nuxt) need no changes -- this is
handled internally. Callers using @oauth-spa-kit/core directly must pass
assertionAudience explicitly, and should pass their AS's issuer
identifier per rfc7523bis rather than the token endpoint URL.

# [1.2.0](https://github.com/ehncraft/oauth-spa-kit/compare/v1.1.0...v1.2.0) (2026-07-11)


### Features

* **nuxt:** derive redirectUri/postLogoutRedirectUri from the request when not configured ([9606aec](https://github.com/ehncraft/oauth-spa-kit/commit/9606aec9077531343cff5d1273bef9771bfaafd1))

# [1.1.0](https://github.com/ehncraft/oauth-spa-kit/compare/v1.0.2...v1.1.0) (2026-07-11)


### Features

* **server:** add OpenID AuthZEN Authorization API client ([20db484](https://github.com/ehncraft/oauth-spa-kit/commit/20db48498b8ae73900bdc181e85388b162f5c6eb))

## [1.0.2](https://github.com/ehncraft/oauth-spa-kit/compare/v1.0.1...v1.0.2) (2026-07-11)


### Bug Fixes

* repair broken ESM resolution, SSR crash, and private key config in published packages ([114df0c](https://github.com/ehncraft/oauth-spa-kit/commit/114df0cb66ebac79781a99a2fde82904fabd8865))

## [1.0.1](https://github.com/ehncraft/oauth-spa-kit/compare/v1.0.0...v1.0.1) (2026-07-10)


### Bug Fixes

* preserve package.json formatting in the version-bump script ([c8d7762](https://github.com/ehncraft/oauth-spa-kit/commit/c8d77628d6683982ef336645766ad70732710be9))

# 1.0.0 (2026-07-10)


### Features

* add npm publish workflow, real-IdP mode for nuxt playground ([bbe9868](https://github.com/ehncraft/oauth-spa-kit/commit/bbe9868a2dd06be312388b57a3c9c81c009dfd71))
* add nuxt package playground, closing the #imports typecheck gap ([f3dc298](https://github.com/ehncraft/oauth-spa-kit/commit/f3dc298eedd0cca3e63f5659295f0aacc71ef3c4)), closes [#imports](https://github.com/ehncraft/oauth-spa-kit/issues/imports) [#imports](https://github.com/ehncraft/oauth-spa-kit/issues/imports)
* automate versioning and npm publishing with semantic-release ([2f364aa](https://github.com/ehncraft/oauth-spa-kit/commit/2f364aae22d24d9b6ba5804bdde9a5417a417cfa))
* FAPI 2.0 / FIPS-compliant client auth, PAR, DPoP by default, id_token verification, tests ([55a42a1](https://github.com/ehncraft/oauth-spa-kit/commit/55a42a1443e3c4c7e727e49375c188d51efb3cda))
* initial sketch of framework-agnostic OAuth SPA kit ([852b5d4](https://github.com/ehncraft/oauth-spa-kit/commit/852b5d4c4721ffe5f816c2528ef0b3b6668dd5a8))
