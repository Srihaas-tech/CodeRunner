#!/usr/bin/env bun
// Downloads the prebuilt PathPlanner web dist into dist/pathplanner.
//
// PathPlanner is built by the separate `pathplanner-web` fork (Flutter stays
// out of this repo's toolchain), so it only ever arrives as a release
// artifact — there is no local build to fall back on.
//
// Failure policy differs by caller:
//   - `bun run build` (production from source) runs this directly, and a
//     missing artifact fails the build: a production build should contain
//     every advertised feature.
//   - `fetch:dist` (the demo/quick-start path) calls fetchPathPlannerDist with
//     `optional: true`, so a missing artifact degrades to a 503 on
//     /pathplanner/ instead of blocking the whole demo setup.

import { resolve } from "node:path";
import { downloadAndExtract, withScratch } from "./dist-download";

const repoRoot = resolve(import.meta.dirname, "..");

// Overridable so forks can point at their own releases.
const repo = Bun.env.PATHPLANNER_RELEASE_REPO ?? "mathewdunne/pathplanner-web";
// Defaults to the newest published release; set PATHPLANNER_RELEASE_TAG to pin.
const tag = Bun.env.PATHPLANNER_RELEASE_TAG ?? "";

export async function fetchPathPlannerDist(
	options: { optional?: boolean } = {},
): Promise<boolean> {
	const base = `https://github.com/${repo}/releases`;
	const url = tag
		? `${base}/download/${tag}/pathplanner-dist.tar.gz`
		: `${base}/latest/download/pathplanner-dist.tar.gz`;

	return withScratch((scratch) =>
		downloadAndExtract(
			{
				asset: "pathplanner-dist.tar.gz",
				url,
				destDir: resolve(repoRoot, "dist/pathplanner"),
				optional: options.optional ?? false,
				hint: `Check that release ${tag || "latest"} exists for ${repo} and includes this asset.`,
			},
			scratch,
		),
	);
}

if (import.meta.main) {
	try {
		await fetchPathPlannerDist();
		console.log("\nPathPlanner web assets are ready.");
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
