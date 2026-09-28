/**
 * Shared download+extract for prebuilt release tarballs. Used by
 * `fetch-dist.ts` (web shell + AdvantageScope Lite) and
 * `fetch-pathplanner-dist.ts`, which differ only in which releases they pull
 * from and whether a missing asset is fatal.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type DistDownload = {
	/** Release asset filename, e.g. `web-dist.tar.gz`. */
	asset: string;
	url: string;
	destDir: string;
	/** Warn and skip instead of throwing when the asset is missing. */
	optional?: boolean;
	/** Appended to the failure message to point at the likely cause. */
	hint?: string;
};

async function run(command: string, args: string[]): Promise<void> {
	const subprocess = Bun.spawn([command, ...args], {
		stdout: "inherit",
		stderr: "inherit",
		stdin: "ignore",
	});
	const exitCode = await subprocess.exited;
	if (exitCode !== 0) {
		throw new Error(
			`${command} ${args.join(" ")} failed with exit ${exitCode}.`,
		);
	}
}

/** Runs `fn` with a temp dir that is removed afterwards either way. */
export async function withScratch<T>(
	fn: (scratch: string) => Promise<T>,
): Promise<T> {
	const scratch = await mkdtemp(join(tmpdir(), "coderunner-dist-"));
	try {
		return await fn(scratch);
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}

/** Returns false when an optional asset was missing and got skipped. */
export async function downloadAndExtract(
	download: DistDownload,
	scratch: string,
): Promise<boolean> {
	console.log(`\nDownloading ${download.asset} from ${download.url}`);
	const response = await fetch(download.url);
	if (!response.ok) {
		const message = `Failed to download ${download.asset}: ${response.status} ${response.statusText}.`;
		if (download.optional) {
			console.warn(`${message} Skipping (optional artifact).`);
			return false;
		}
		throw new Error(download.hint ? `${message} ${download.hint}` : message);
	}

	const tarPath = join(scratch, download.asset);
	await writeFile(tarPath, Buffer.from(await response.arrayBuffer()));

	// Reset the destination so a re-fetch never mixes old and new files. `tar` is
	// available on Windows 11, macOS, and Linux.
	await rm(download.destDir, { recursive: true, force: true });
	await mkdir(download.destDir, { recursive: true });
	await run("tar", ["-xzf", tarPath, "-C", download.destDir]);
	console.log(`Extracted ${download.asset} -> ${download.destDir}`);
	return true;
}
