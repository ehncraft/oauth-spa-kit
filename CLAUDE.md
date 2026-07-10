# CLAUDE.md

## Git workflow

Always open a pull request for changes instead of pushing directly to
`master`. Create a branch, push it, and open a PR (`gh pr create`) — even
when asked to just "commit and push" or "push it". Only push straight to
`master` if explicitly told to do that specifically.

The one exception is `.github/workflows/release.yml`'s own
`chore(release): x.y.z` commits — semantic-release pushes those to
`master` directly from CI as part of its normal flow; that's expected, not
a violation of this rule.

## Commits

Conventional Commits (`feat:`, `fix:`, `docs:`, etc.), enforced by
commitlint + husky on every commit. semantic-release derives version bumps
and the changelog from these — see the README's "Releasing" section.
