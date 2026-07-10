#!/usr/bin/env node
// Writes one version into every packages/*/package.json for semantic-release's
// lockstep monorepo release (see release.config.js's exec prepareCmd). Internal
// "workspace:*" deps are left untouched -- `pnpm publish` resolves those to the
// real version at publish time, which is correct here since every package gets
// the same version.
//
// Edits the "version" field in place via a regex on the raw text, rather than
// JSON.parse + JSON.stringify -- a full round trip reformats the whole file
// (e.g. collapses `"files": ["dist"]` onto multiple lines), turning every
// release commit's diff into unrelated formatting churn.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const version = process.argv[2];
if (!version) {
  console.error("usage: set-versions.mjs <version>");
  process.exit(1);
}

const packagesDir = new URL("../packages/", import.meta.url).pathname;

for (const name of readdirSync(packagesDir)) {
  const pkgPath = join(packagesDir, name, "package.json");
  try {
    if (!statSync(pkgPath).isFile()) continue;
  } catch {
    continue;
  }

  const raw = readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(raw);
  if (pkg.private) continue; // skip the playground

  writeFileSync(pkgPath, raw.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`));
  console.log(`  ${pkg.name}@${version}`);
}
