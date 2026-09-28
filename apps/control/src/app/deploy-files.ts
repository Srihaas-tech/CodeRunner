import { existsSync, constants as fsConstants } from "node:fs";
import {
	lstat,
	mkdir,
	open,
	readdir,
	realpath,
	rm,
	stat,
} from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import {
	DEPLOY_FILES_READ_ROOTS,
	DEPLOY_FILES_WRITE_ROOT,
	type DeployFile,
	deployFilePathSchema,
} from "@frc-coderunner/contracts";
import { getLogger } from "../logging";
import { isInsideDirectory } from "./assets";
import { jsonResponse } from "./responses";

const log = getLogger("deploy-files");

/**
 * Per-file ceiling for reads and writes. PathPlanner files are small JSON
 * (paths/autos are a few KB, navgrid a few hundred KB); anything bigger is
 * not ours to sync.
 */
const MAX_DEPLOY_FILE_BYTES = 5 * 1024 * 1024;

/**
 * Aggregate ceilings for a single snapshot response. Workspace containers
 * have no disk quota, so without these a student could fill the deploy dir
 * with GBs and force the control plane to buffer and JSON.stringify all of
 * it in one response, starving every other student it's serving concurrently.
 */
const MAX_DEPLOY_SNAPSHOT_BYTES = 25 * 1024 * 1024;
const MAX_DEPLOY_SNAPSHOT_FILES = 2000;

const INVALID_PATH_ERROR = { error: "Invalid deploy file path." } as const;

type DeployWorkspace = { project_path: string };

/** Decode and validate the path suffix of /api/deploy-files/<path>. */
export function parseDeployFilePath(rawSuffix: string): string | null {
	let decoded: string;
	try {
		decoded = decodeURIComponent(rawSuffix);
	} catch {
		return null;
	}
	const parsed = deployFilePathSchema.safeParse(decoded);
	return parsed.success ? parsed.data : null;
}

function isWritableDeployPath(path: string): boolean {
	return path.startsWith(`${DEPLOY_FILES_WRITE_ROOT}/`);
}

/** Resolve a validated relative path inside the project, or null on escape. */
function resolveInProject(
	workspace: DeployWorkspace,
	path: string,
): string | null {
	const projectRoot = resolve(workspace.project_path);
	const target = resolve(projectRoot, path);
	return isInsideDirectory(projectRoot, target) ? target : null;
}

/**
 * Walk up from `path` (lstat, so a symlink counts as "existing" without
 * following it) to the nearest ancestor that actually exists on disk. Used
 * to realpath-check for a planted directory symlink *before* `mkdir -p` has
 * a chance to walk through it and create files on the other side.
 */
async function findDeepestExistingAncestor(path: string): Promise<string> {
	let current = path;
	for (;;) {
		const exists = await lstat(current).then(
			() => true,
			() => false,
		);
		if (exists) {
			return current;
		}
		const parent = dirname(current);
		if (parent === current) {
			return current;
		}
		current = parent;
	}
}

/**
 * Confirm `dir` (which must already exist) resolves, symlinks and all, to
 * somewhere inside the real project root. Returns false on any resolution
 * failure or escape.
 */
async function isRealPathInsideProject(
	dir: string,
	realProjectRoot: string,
): Promise<boolean> {
	const real = await realpath(dir).catch(() => null);
	return real !== null && isInsideDirectory(realProjectRoot, real);
}

/**
 * Whether this host exposes `/proc/self/fd`, which is what lets us resolve an
 * open descriptor back to the file it actually refers to. Linux (every
 * deployment target, and the CI/dev containers) has it; macOS does not, and
 * Node exposes no portable equivalent.
 */
const HAS_PROC_SELF_FD = existsSync("/proc/self/fd");

/**
 * Confirm the file an open descriptor actually refers to lives inside the
 * real project root.
 *
 * The directory-component checks are path-based, which makes them
 * check-then-use: a student can write to their own deploy dir, so they can
 * swap a real directory for a symlink in the window between the check and the
 * open and have the open resolve somewhere else entirely. Resolving the
 * descriptor we already hold closes that race — it names the inode we opened,
 * which cannot be re-pointed underneath us.
 *
 * Returns true on a host without `/proc` rather than failing closed: there the
 * path-based checks are all we have, and refusing every write would be worse
 * than the race. Deployments run on Linux, where the check is live.
 */
async function isOpenFileInsideProject(
	fd: number,
	realProjectRoot: string,
): Promise<boolean> {
	if (!HAS_PROC_SELF_FD) {
		return true;
	}
	return isRealPathInsideProject(`/proc/self/fd/${fd}`, realProjectRoot);
}

type SnapshotBudget = {
	totalBytes: number;
	fileCount: number;
	truncated: boolean;
};

async function collectFiles(
	directory: string,
	rootDir: string,
	rootPrefix: string,
	out: DeployFile[],
	budget: SnapshotBudget,
): Promise<void> {
	if (budget.truncated) {
		return;
	}
	const entries = await readdir(directory, { withFileTypes: true }).catch(
		() => null,
	);
	if (!entries) {
		return;
	}
	for (const entry of entries) {
		if (budget.truncated) {
			return;
		}
		if (entry.name.startsWith(".")) {
			continue;
		}
		const absolutePath = resolve(directory, entry.name);
		if (entry.isDirectory()) {
			await collectFiles(absolutePath, rootDir, rootPrefix, out, budget);
			continue;
		}
		if (!entry.isFile()) {
			continue;
		}
		const fileStat = await stat(absolutePath).catch(() => null);
		if (!fileStat) {
			log.warn("deploy-files snapshot skipped missing file", {
				path: absolutePath,
			});
			continue;
		}
		if (fileStat.size > MAX_DEPLOY_FILE_BYTES) {
			log.warn("deploy-files snapshot skipped oversized file", {
				path: absolutePath,
			});
			continue;
		}
		if (
			budget.fileCount + 1 > MAX_DEPLOY_SNAPSHOT_FILES ||
			budget.totalBytes + fileStat.size > MAX_DEPLOY_SNAPSHOT_BYTES
		) {
			budget.truncated = true;
			return;
		}
		const content = await Bun.file(absolutePath)
			.text()
			.catch(() => null);
		if (content === null) {
			log.warn("deploy-files snapshot skipped unreadable file", {
				path: absolutePath,
			});
			continue;
		}
		const rel = relative(rootDir, absolutePath).split(sep).join("/");
		out.push({
			path: `${rootPrefix}/${rel}`,
			content,
		});
		budget.fileCount += 1;
		budget.totalBytes += fileStat.size;
	}
}

export async function deployFilesSnapshotResponse(
	workspace: DeployWorkspace,
): Promise<Response> {
	const files: DeployFile[] = [];
	const budget: SnapshotBudget = {
		totalBytes: 0,
		fileCount: 0,
		truncated: false,
	};
	for (const root of DEPLOY_FILES_READ_ROOTS) {
		const rootDir = resolve(workspace.project_path, root);
		await collectFiles(rootDir, rootDir, root, files, budget);
	}
	if (budget.truncated) {
		log.warn("deploy-files snapshot truncated by aggregate cap", {
			projectPath: workspace.project_path,
		});
	}
	return jsonResponse({ ok: true, files });
}

export async function deployFileWriteResponse(
	workspace: DeployWorkspace,
	path: string,
	request: Request,
): Promise<Response> {
	if (!isWritableDeployPath(path)) {
		return jsonResponse(
			{ error: "Only files under the PathPlanner deploy dir are writable." },
			{ status: 403 },
		);
	}
	const body = await request.text();
	if (Buffer.byteLength(body, "utf8") > MAX_DEPLOY_FILE_BYTES) {
		return jsonResponse({ error: "File is too large." }, { status: 413 });
	}
	const target = resolveInProject(workspace, path);
	if (!target) {
		return jsonResponse(INVALID_PATH_ERROR, { status: 400 });
	}

	const projectRoot = resolve(workspace.project_path);
	const realProjectRoot = await realpath(projectRoot).catch(() => projectRoot);
	const targetDir = dirname(target);

	// Directory-component check #1: before creating anything, confirm the
	// deepest ancestor that already exists (lstat, so a planted symlink
	// counts) resolves inside the real project root. This must happen before
	// `mkdir -p`, which would otherwise happily walk through a directory
	// symlink and create files on the other side of it.
	const deepestExisting = await findDeepestExistingAncestor(targetDir);
	if (!(await isRealPathInsideProject(deepestExisting, realProjectRoot))) {
		return jsonResponse(INVALID_PATH_ERROR, { status: 403 });
	}

	await mkdir(targetDir, { recursive: true });

	// Directory-component check #2: re-check after mkdir in case the walk
	// itself resolved through something unexpected.
	if (!(await isRealPathInsideProject(targetDir, realProjectRoot))) {
		return jsonResponse(INVALID_PATH_ERROR, { status: 403 });
	}

	// Final-component check: O_NOFOLLOW refuses to open through a symlink
	// left as the last path segment, so a planted symlink can't be used to
	// overwrite an arbitrary file the control-plane user can write.
	//
	// O_TRUNC is deliberately absent: the checks above are path-based and so
	// lose a race against a directory swapped for a symlink mid-request. If
	// that happens we want to have opened the wrong file, not to have already
	// emptied it — the descriptor check below catches it while the contents
	// are still intact.
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(
			target,
			fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_NOFOLLOW,
		);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ELOOP" || code === "EEXIST") {
			return jsonResponse(INVALID_PATH_ERROR, { status: 403 });
		}
		throw error;
	}
	try {
		if (!(await isOpenFileInsideProject(handle.fd, realProjectRoot))) {
			return jsonResponse(INVALID_PATH_ERROR, { status: 403 });
		}
		await handle.truncate(0);
		await handle.writeFile(body, "utf8");
	} finally {
		await handle.close();
	}
	return jsonResponse({ ok: true });
}

export async function deployFileDeleteResponse(
	workspace: DeployWorkspace,
	path: string,
): Promise<Response> {
	if (!isWritableDeployPath(path)) {
		return jsonResponse(
			{ error: "Only files under the PathPlanner deploy dir are writable." },
			{ status: 403 },
		);
	}
	const target = resolveInProject(workspace, path);
	if (!target) {
		return jsonResponse(INVALID_PATH_ERROR, { status: 400 });
	}

	const projectRoot = resolve(workspace.project_path);
	const realProjectRoot = await realpath(projectRoot).catch(() => projectRoot);
	const targetDir = dirname(target);

	// Directory-component check: a planted directory symlink could make the
	// lexical target land inside the project while its real location is
	// elsewhere, e.g. shared across students.
	const realTargetDir = await realpath(targetDir).catch(() => null);
	if (!realTargetDir) {
		return jsonResponse({ error: "File not found." }, { status: 404 });
	}
	if (!isInsideDirectory(realProjectRoot, realTargetDir)) {
		return jsonResponse(INVALID_PATH_ERROR, { status: 403 });
	}

	// Final-component check: lstat has symlink semantics, so a planted
	// symlink is refused instead of followed-and-deleted.
	const fileLstat = await lstat(target).catch(() => null);
	if (!fileLstat) {
		return jsonResponse({ error: "File not found." }, { status: 404 });
	}
	if (fileLstat.isSymbolicLink()) {
		return jsonResponse(INVALID_PATH_ERROR, { status: 403 });
	}
	if (!fileLstat.isFile()) {
		return jsonResponse({ error: "File not found." }, { status: 404 });
	}

	// Same check-then-use race as the write path, narrowed the same way: open
	// the target and confirm the descriptor resolves inside the project before
	// unlinking. Node exposes no `unlinkat`, so the gap between this check and
	// the `rm` below cannot be closed entirely — the residual is unlinking a
	// leaf the caller already named, not the arbitrary overwrite the write path
	// would otherwise allow.
	let deleteHandle: Awaited<ReturnType<typeof open>>;
	try {
		deleteHandle = await open(
			target,
			fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
		);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ELOOP") {
			return jsonResponse(INVALID_PATH_ERROR, { status: 403 });
		}
		if (code === "ENOENT") {
			return jsonResponse({ error: "File not found." }, { status: 404 });
		}
		throw error;
	}
	try {
		if (!(await isOpenFileInsideProject(deleteHandle.fd, realProjectRoot))) {
			return jsonResponse(INVALID_PATH_ERROR, { status: 403 });
		}
	} finally {
		await deleteHandle.close();
	}

	await rm(target);
	return jsonResponse({ ok: true });
}
