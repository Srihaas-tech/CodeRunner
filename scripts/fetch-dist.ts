#!/usr/bin/env bun
import { resolve } from "node:path";

// Downloads the prebuilt release artifacts (web shell + AdvantageScope Lite)
// instead of building them from source. This is the demo/quick-start path: it
// skips the emscripten-dependent `build:ascope` compile entirely by reusing the
// `ascope-dist.tar.gz` and `web-dist.tar.gz` already published on each release.
// The GCE deploy does the same thing (see .github/workflows/deploy.yml).
//
// PathPlanner ships from its own fork's releases, so it comes last and stays
// optional here — a missing artifact leaves /pathplanner/ serving a 503 rather
// than breaking demo setup. `bun run build` fetches it strictly instead.

import { downloadAndExtract, withScratch } from "./dist-download";
import { fetchPathPlannerDist } from "./fetch-pathplanner-dist";

const repoRoot = resolve(import.meta.dirname, "..");

// Overridable so forks can point at their own releases.
const repo = Bun.env.DEMO_RELEASE_REPO ?? "mathewdunne/CodeRunner";

// Default to the newest published release. Pass `--tag vX.Y.Z` to pin.
const tagArgIndex = Bun.argv.indexOf("--tag");
const tag =
	tagArgIndex >= 0
		? Bun.argv[tagArgIndex + 1]
		: (Bun.env.DEMO_RELEASE_TAG ?? "");

const artifacts = [
	{
		asset: "ascope-dist.tar.gz",
		destDir: resolve(repoRoot, "dist/advantagescope"),
	},
	{ asset: "web-dist.tar.gz", destDir: resolve(repoRoot, "apps/web/dist") },
];

function downloadUrl(asset: string): string {
	const base = `https://github.com/${repo}/releases`;
	return tag
		? `${base}/download/${tag}/${asset}`
		: `${base}/latest/download/${asset}`;
}

async function main(): Promise<void> {
	console.log(
		`Fetching prebuilt dist artifacts from ${repo} (${tag || "latest release"}).`,
	);
	await withScratch(async (scratch) => {
		for (const artifact of artifacts) {
			await downloadAndExtract(
				{
					asset: artifact.asset,
					url: downloadUrl(artifact.asset),
					destDir: artifact.destDir,
					hint: `Check that release ${tag || "latest"} exists for ${repo} and includes this asset.`,
				},
				scratch,
			);
		}
	});
	await fetchPathPlannerDist({ optional: true });
	console.log("\nPrebuilt web shell and AdvantageScope Lite assets are ready.");
}

try {
	await main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
