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
// No @semantic-release/git: master's ruleset rejects any direct push, with no bypass available
// to a personal-account repo's default GITHUB_TOKEN (confirmed: neither an Integration bypass
// actor -- "github-actions" is owned by GitHub's own org, not this account, so personal repos
// can't add it -- nor a RepositoryRole bypass, which only covers human-authenticated pushes,
// not the bot token GitHub Actions runs as). The version-bump/changelog commit this plugin used
// to push straight to master is instead opened and merged as its own PR by
// .github/workflows/release.yml's own step, right after this config's "prepare" plugins
// (changelog, exec's set-versions.mjs) have already written the files to disk -- git tagging
// and the GitHub Release itself (below, @semantic-release/github) are semantic-release core's
// own responsibility, not this plugin's, so removing it doesn't affect those.
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
    "@semantic-release/github",
  ],
};
