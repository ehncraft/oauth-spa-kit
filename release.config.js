// Lockstep monorepo release: one version, computed from Conventional Commits
// across the whole history, applied to all 4 packages/* packages together.
//
// @semantic-release/npm isn't used for the actual publish -- it shells out to
// plain `npm publish`, which doesn't rewrite pnpm's `workspace:*` protocol in
// internal deps (packages/server -> @oauth-spa-kit/core etc.) into real
// semver. @semantic-release/exec instead runs scripts/set-versions.mjs to
// stamp every package.json with the new version, then `pnpm run
// publish:packages`, which uses `pnpm publish` and resolves `workspace:*`
// correctly.
export default {
  branches: ["master"],
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/changelog",
    [
      "@semantic-release/exec",
      {
        prepareCmd: "node scripts/set-versions.mjs ${nextRelease.version}",
        publishCmd: "pnpm run publish:packages",
      },
    ],
    [
      "@semantic-release/git",
      {
        assets: ["CHANGELOG.md", "packages/*/package.json"],
        message: "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}",
      },
    ],
    "@semantic-release/github",
  ],
};
