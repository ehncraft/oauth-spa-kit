#!/usr/bin/env node
// Writes one version into every packages/*/package.json for semantic-release's
// lockstep monorepo release (see release.config.js's exec prepareCmd). Internal
// "workspace:*" deps are left untouched -- `pnpm publish` resolves those to the
// real version at publish time, which is correct here since every package gets
// the same version.
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
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

  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (pkg.private) continue; // skip the playground

  pkg.version = version;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`  ${pkg.name}@${version}`);
}
