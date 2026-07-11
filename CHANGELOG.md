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
