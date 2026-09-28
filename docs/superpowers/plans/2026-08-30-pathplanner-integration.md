# PathPlanner Integration (CodeRunner side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give CodeRunner everything PathPlanner-web needs to run inside it — the deploy-files CRUD API, static serving of the PathPlanner build at `/pathplanner/`, release-tarball packaging — plus fully written and tested (but deliberately unwired) web-shell UI components for the pane toggle.

**Architecture:** Additive only. New zod schemas in `@frc-coderunner/contracts`, a new `deploy-files` handler module wired into the existing `/u/:slug/api/` workspace routes behind `requireWorkspaceOwnership`, a `/pathplanner/` static route mirroring `/scope/`, a `pathplannerDistDir` config entry fed by a prebuilt release tarball from the pathplanner-web fork (Flutter stays out of this repo's toolchain), and two new React components that stay out of the component tree behind a `TODO(pathplanner)` comment.

**Tech Stack:** TypeScript on Bun (control plane, `bun:test`), zod contracts, React + Vitest + Testing Library (web shell), Docker multi-stage build.

**Spec:** The interface agreement lives in the pathplanner-web repo: `/home/matt/dev/pathplanner-web/docs/superpowers/specs/2026-08-30-coderunner-web-design.md` (section "Interface agreement with CodeRunner"). It is restated below — the two repos must not drift.

## Global Constraints

- All non-container code is TypeScript on Bun. Follow existing file style exactly: tabs, double quotes, Biome-formatted.
- Run `bun run check:fix` before every commit; `bun run verify` gates CI on `biome ci`, `tsc`, and tests.
- Do not change any existing endpoint's behavior. Everything here is additive.
- Use shared contracts before changing API shapes: schemas go in `packages/contracts/src/index.ts` first.
- Never expose per-user ports to the browser; never use query-param identity on production routes (the `?ws=` param on `/pathplanner/` selects only which API base the iframe calls — identity still comes from the session cookie on those API calls).
- The UI components are written and tested but MUST NOT be mounted: `WorkspacePage.tsx` gets only a `TODO(pathplanner)` comment. No behavior change to the shipped shell.
- After modifying code files, run `graphify update .` (repo rule in AGENTS.md).

## Interface agreement (must match the pathplanner-web spec verbatim)

- `GET /u/:slug/api/deploy-files/snapshot` → `200` `{ "ok": true, "files": [{ "path": "<relative to project root>", "content": "<file text>" }] }`. Covers `src/main/deploy/pathplanner/**` (read-write) and `src/main/deploy/choreo/**` (read-only). Empty `files` when no deploy dir exists.
- `PUT /u/:slug/api/deploy-files/<path>` with the raw file text as body → `200` `{ "ok": true }`. Creates parent dirs. Only `src/main/deploy/pathplanner/**` is writable.
- `DELETE /u/:slug/api/deploy-files/<path>` → `200` `{ "ok": true }`; `404` when the file does not exist (the PathPlanner client treats 404 as success).
- Errors: `{ "error": "<message>" }` with 400 (invalid path), 403 (not writable / not owner), 413 (too large), 5xx.
- Auth: session cookie via `requireWorkspaceOwnership` — same as every other `/u/:slug/api/` route.
- The PathPlanner build is served at `/pathplanner/` (public GET, static assets only, like `/scope/`); the shell iframes `/pathplanner/?ws=<slug>`.

---

### Task 1: Deploy-files contracts

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/index.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Tasks 2's handlers and tests):
  - `DEPLOY_FILES_WRITE_ROOT = "src/main/deploy/pathplanner"` and `DEPLOY_FILES_READ_ROOTS` (write root + `"src/main/deploy/choreo"`)
  - `deployFilePathSchema` (zod string schema for a safe relative file path)
  - `deployFileSchema`, `deployFilesSnapshotResponseSchema`, `deployFilesWriteResponseSchema` and their inferred types `DeployFile`, `DeployFilesSnapshotResponse`, `DeployFilesWriteResponse`

- [ ] **Step 1: Write the failing tests**

Append to `packages/contracts/src/index.test.ts` (match the file's existing `bun:test` style):

```ts
describe("deployFilePathSchema", () => {
	test("accepts realistic PathPlanner file paths", () => {
		for (const path of [
			"src/main/deploy/pathplanner/paths/Example Path.path",
			"src/main/deploy/pathplanner/autos/Two Piece (Left).auto",
			"src/main/deploy/pathplanner/settings.json",
			"src/main/deploy/choreo/Trajectory.traj",
		]) {
			expect(deployFilePathSchema.safeParse(path).success).toBe(true);
		}
	});

	test("rejects traversal, absolute, hidden, and malformed paths", () => {
		for (const path of [
			"",
			"/etc/passwd",
			"src/main/deploy/pathplanner/../secrets.json",
			"src/main/deploy/pathplanner/.hidden",
			"src\\main\\deploy\\pathplanner\\x.path",
			"src/main/deploy/pathplanner//double.path",
			`src/${"a".repeat(600)}.path`,
		]) {
			expect(deployFilePathSchema.safeParse(path).success).toBe(false);
		}
	});
});

describe("deployFilesSnapshotResponseSchema", () => {
	test("accepts a snapshot payload", () => {
		const parsed = deployFilesSnapshotResponseSchema.safeParse({
			ok: true,
			files: [
				{
					path: "src/main/deploy/pathplanner/paths/A.path",
					content: "{}",
				},
			],
		});
		expect(parsed.success).toBe(true);
	});
});
```

Add `deployFilePathSchema, deployFilesSnapshotResponseSchema` to the test file's import from `./index`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/contracts`
Expected: FAIL — the schemas are not exported.

- [ ] **Step 3: Implement the schemas**

Append to `packages/contracts/src/index.ts`:

```ts
// --- Deploy files (PathPlanner) schemas ---

/** Only files under this project-relative root may be written or deleted. */
export const DEPLOY_FILES_WRITE_ROOT = "src/main/deploy/pathplanner";

/** Roots included in the snapshot; choreo is read-only in the GUI. */
export const DEPLOY_FILES_READ_ROOTS = [
	DEPLOY_FILES_WRITE_ROOT,
	"src/main/deploy/choreo",
] as const;

// Segments start with an alphanumeric (blocks "..", ".hidden") and allow the
// characters PathPlanner puts in user-named path/auto files (spaces, parens).
export const deployFilePathSchema = z
	.string()
	.min(1)
	.max(512)
	.regex(
		/^[A-Za-z0-9][A-Za-z0-9 ._()-]*(?:\/[A-Za-z0-9][A-Za-z0-9 ._()-]*)*$/,
		"Path must be a relative path made of safe segments.",
	);

export const deployFileSchema = z.object({
	path: deployFilePathSchema,
	content: z.string(),
});

export const deployFilesSnapshotResponseSchema = z.object({
	ok: z.literal(true),
	files: z.array(deployFileSchema),
});

export const deployFilesWriteResponseSchema = z.object({
	ok: z.literal(true),
});

export type DeployFile = z.infer<typeof deployFileSchema>;
export type DeployFilesSnapshotResponse = z.infer<
	typeof deployFilesSnapshotResponseSchema
>;
export type DeployFilesWriteResponse = z.infer<
	typeof deployFilesWriteResponseSchema
>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/contracts`
Expected: PASS (existing + new tests).

- [ ] **Step 5: Commit**

```bash
bun run check:fix
git add packages/contracts
git commit -m "contracts: add deploy-files schemas for PathPlanner"
```

---

### Task 2: Deploy-files handlers and workspace routes

**Files:**
- Create: `apps/control/src/app/deploy-files.ts`
- Modify: `apps/control/src/app/workspace-routes.ts`
- Test: `apps/control/src/__tests__/deploy-files.test.ts`

**Interfaces:**
- Consumes: Task 1's contracts; existing `isInsideDirectory` (`./assets`), `jsonResponse` (`./responses`), `requireWorkspaceOwnership` (already applied in `handleWorkspaceRoute` — handlers receive `auth.workspace`).
- Produces:
  - `deployFilesSnapshotResponse(workspace: { project_path: string }): Promise<Response>`
  - `deployFileWriteResponse(workspace, path: string, request: Request): Promise<Response>`
  - `deployFileDeleteResponse(workspace, path: string): Promise<Response>`
  - `parseDeployFilePath(rawSuffix: string): string | null`

- [ ] **Step 1: Write the failing tests**

Create `apps/control/src/__tests__/deploy-files.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DeployFilesSnapshotResponse } from "@frc-coderunner/contracts";
import {
	cookieFrom,
	createFakeDocker,
	login,
	withApp,
	workspaceProjectPath,
} from "./helpers";

const PP = "src/main/deploy/pathplanner";
const CHOREO = "src/main/deploy/choreo";

async function seedDeployTree(projectPath: string): Promise<void> {
	await mkdir(join(projectPath, PP, "paths"), { recursive: true });
	await mkdir(join(projectPath, CHOREO), { recursive: true });
	await writeFile(
		join(projectPath, PP, "paths", "Example.path"),
		'{"version": "2025.0"}',
		"utf8",
	);
	await writeFile(join(projectPath, PP, "settings.json"), "{}", "utf8");
	await writeFile(join(projectPath, CHOREO, "Traj.traj"), "{}", "utf8");
	// Dotfiles must never leak into the snapshot.
	await writeFile(join(projectPath, PP, ".DS_Store"), "junk", "utf8");
}

describe("GET /u/:slug/api/deploy-files/snapshot", () => {
	test("returns pathplanner and choreo files, skipping dotfiles", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const cookie = cookieFrom(await login(app, "alice"));
				await seedDeployTree(workspaceProjectPath(app, "alice"));

				const resp = await app.fetch(
					new Request("http://localhost/u/alice/api/deploy-files/snapshot", {
						headers: { cookie },
					}),
				);
				expect(resp.status).toBe(200);
				const body = (await resp.json()) as DeployFilesSnapshotResponse;
				expect(body.ok).toBe(true);
				expect(body.files.map((f) => f.path).sort()).toEqual([
					`${CHOREO}/Traj.traj`,
					`${PP}/paths/Example.path`,
					`${PP}/settings.json`,
				]);
				const example = body.files.find(
					(f) => f.path === `${PP}/paths/Example.path`,
				);
				expect(example?.content).toBe('{"version": "2025.0"}');
			},
			{ dockerRunner: docker.runner },
		);
	});

	test("returns an empty list when no deploy dirs exist", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const cookie = cookieFrom(await login(app, "alice"));
				const resp = await app.fetch(
					new Request("http://localhost/u/alice/api/deploy-files/snapshot", {
						headers: { cookie },
					}),
				);
				expect(resp.status).toBe(200);
				expect(await resp.json()).toEqual({ ok: true, files: [] });
			},
			{ dockerRunner: docker.runner },
		);
	});

	test("requires workspace ownership", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				await login(app, "alice");
				const bobCookie = cookieFrom(await login(app, "bob"));
				const resp = await app.fetch(
					new Request("http://localhost/u/alice/api/deploy-files/snapshot", {
						headers: { cookie: bobCookie },
					}),
				);
				expect(resp.status).toBe(403);
			},
			{ dockerRunner: docker.runner },
		);
	});
});

describe("PUT /u/:slug/api/deploy-files/:path", () => {
	test("writes a file, creating parent directories", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const cookie = cookieFrom(await login(app, "alice"));
				const resp = await app.fetch(
					new Request(
						`http://localhost/u/alice/api/deploy-files/${PP}/paths/New.path`,
						{
							method: "PUT",
							headers: { cookie, "content-type": "text/plain" },
							body: '{"a": 1}',
						},
					),
				);
				expect(resp.status).toBe(200);
				expect(await resp.json()).toEqual({ ok: true });
				const written = await readFile(
					join(workspaceProjectPath(app, "alice"), PP, "paths", "New.path"),
					"utf8",
				);
				expect(written).toBe('{"a": 1}');
			},
			{ dockerRunner: docker.runner },
		);
	});

	test("handles URL-encoded names with spaces", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const cookie = cookieFrom(await login(app, "alice"));
				const resp = await app.fetch(
					new Request(
						`http://localhost/u/alice/api/deploy-files/${PP}/paths/Two%20Piece.path`,
						{ method: "PUT", headers: { cookie }, body: "{}" },
					),
				);
				expect(resp.status).toBe(200);
				const written = await readFile(
					join(
						workspaceProjectPath(app, "alice"),
						PP,
						"paths",
						"Two Piece.path",
					),
					"utf8",
				);
				expect(written).toBe("{}");
			},
			{ dockerRunner: docker.runner },
		);
	});

	test("rejects writes outside the pathplanner subtree", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const cookie = cookieFrom(await login(app, "alice"));
				for (const path of [
					`${CHOREO}/Traj.traj`, // choreo is read-only
					"build.gradle",
					"src/main/java/frc/robot/Robot.java",
				]) {
					const resp = await app.fetch(
						new Request(
							`http://localhost/u/alice/api/deploy-files/${path}`,
							{ method: "PUT", headers: { cookie }, body: "x" },
						),
					);
					expect(resp.status).toBe(403);
				}
			},
			{ dockerRunner: docker.runner },
		);
	});

	test("rejects traversal and malformed paths", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const cookie = cookieFrom(await login(app, "alice"));
				// These reach the handler with their encoding intact and fail the
				// path schema.
				for (const raw of [
					`${PP}/..%2fescape.json`,
					`${PP}/.hidden`,
					"%2fetc%2fpasswd",
				]) {
					const resp = await app.fetch(
						new Request(`http://localhost/u/alice/api/deploy-files/${raw}`, {
							method: "PUT",
							headers: { cookie },
							body: "x",
						}),
					);
					expect(resp.status).toBe(400);
				}

				// The WHATWG URL parser collapses percent-encoded dot segments
				// ("%2e%2e" == "..") during parsing, so this arrives as an
				// already-traversed path OUTSIDE the write root → 403, and nothing
				// is written.
				const collapsed = await app.fetch(
					new Request(
						`http://localhost/u/alice/api/deploy-files/${PP}/%2e%2e/escape.json`,
						{ method: "PUT", headers: { cookie }, body: "x" },
					),
				);
				expect(collapsed.status).toBe(403);
			},
			{ dockerRunner: docker.runner },
		);
	});

	test("rejects oversized bodies with 413", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const cookie = cookieFrom(await login(app, "alice"));
				const resp = await app.fetch(
					new Request(
						`http://localhost/u/alice/api/deploy-files/${PP}/big.json`,
						{
							method: "PUT",
							headers: { cookie },
							body: "x".repeat(5 * 1024 * 1024 + 1),
						},
					),
				);
				expect(resp.status).toBe(413);
			},
			{ dockerRunner: docker.runner },
		);
	});
});

describe("DELETE /u/:slug/api/deploy-files/:path", () => {
	test("deletes an existing file and 404s a missing one", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const cookie = cookieFrom(await login(app, "alice"));
				await seedDeployTree(workspaceProjectPath(app, "alice"));

				const del = await app.fetch(
					new Request(
						`http://localhost/u/alice/api/deploy-files/${PP}/paths/Example.path`,
						{ method: "DELETE", headers: { cookie } },
					),
				);
				expect(del.status).toBe(200);

				const again = await app.fetch(
					new Request(
						`http://localhost/u/alice/api/deploy-files/${PP}/paths/Example.path`,
						{ method: "DELETE", headers: { cookie } },
					),
				);
				expect(again.status).toBe(404);
			},
			{ dockerRunner: docker.runner },
		);
	});

	test("refuses to delete outside the pathplanner subtree", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const cookie = cookieFrom(await login(app, "alice"));
				await seedDeployTree(workspaceProjectPath(app, "alice"));
				const resp = await app.fetch(
					new Request(
						`http://localhost/u/alice/api/deploy-files/${CHOREO}/Traj.traj`,
						{ method: "DELETE", headers: { cookie } },
					),
				);
				expect(resp.status).toBe(403);
			},
			{ dockerRunner: docker.runner },
		);
	});
});
```

Note: `workspaceProjectPath(app, slug)` requires the workspace row to exist — `login(app, "alice")` creates it. If the project dir itself is not created by login, `seedDeployTree`'s `mkdir recursive` covers it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test apps/control/src/__tests__/deploy-files.test.ts`
Expected: FAIL — snapshot route returns 404 (`null` falls through `handleWorkspaceRoute`).

- [ ] **Step 3: Implement the handler module**

Create `apps/control/src/app/deploy-files.ts`:

```ts
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
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

async function collectFiles(
	directory: string,
	rootDir: string,
	rootPrefix: string,
	out: DeployFile[],
): Promise<void> {
	const entries = await readdir(directory, { withFileTypes: true }).catch(
		() => null,
	);
	if (!entries) {
		return;
	}
	for (const entry of entries) {
		if (entry.name.startsWith(".")) {
			continue;
		}
		const absolutePath = resolve(directory, entry.name);
		if (entry.isDirectory()) {
			await collectFiles(absolutePath, rootDir, rootPrefix, out);
			continue;
		}
		if (!entry.isFile()) {
			continue;
		}
		const fileStat = await stat(absolutePath).catch(() => null);
		if (!fileStat || fileStat.size > MAX_DEPLOY_FILE_BYTES) {
			log.warn("deploy-files snapshot skipped oversized file", {
				path: absolutePath,
			});
			continue;
		}
		const rel = relative(rootDir, absolutePath).split(sep).join("/");
		out.push({
			path: `${rootPrefix}/${rel}`,
			content: await Bun.file(absolutePath).text(),
		});
	}
}

export async function deployFilesSnapshotResponse(
	workspace: DeployWorkspace,
): Promise<Response> {
	const files: DeployFile[] = [];
	for (const root of DEPLOY_FILES_READ_ROOTS) {
		const rootDir = resolve(workspace.project_path, root);
		await collectFiles(rootDir, rootDir, root, files);
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
		return jsonResponse({ error: "Invalid deploy file path." }, { status: 400 });
	}
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, body, "utf8");
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
		return jsonResponse({ error: "Invalid deploy file path." }, { status: 400 });
	}
	const fileStat = await stat(target).catch(() => null);
	if (!fileStat || !fileStat.isFile()) {
		return jsonResponse({ error: "File not found." }, { status: 404 });
	}
	await rm(target);
	return jsonResponse({ ok: true });
}
```

- [ ] **Step 4: Wire the routes**

In `apps/control/src/app/workspace-routes.ts`, add after the lesson-catalog endpoints block (before the import endpoints):

```ts
	// --- Deploy files (PathPlanner) endpoints ---
	if (suffix === "/api/deploy-files/snapshot" && request.method === "GET") {
		return deployFilesSnapshotResponse(auth.workspace);
	}

	if (suffix.startsWith("/api/deploy-files/")) {
		const rawPath = suffix.slice("/api/deploy-files/".length);
		const filePath = parseDeployFilePath(rawPath);
		if (!filePath) {
			return jsonResponse(
				{ error: "Invalid deploy file path." },
				{ status: 400 },
			);
		}
		if (request.method === "PUT") {
			return deployFileWriteResponse(auth.workspace, filePath, request);
		}
		if (request.method === "DELETE") {
			return deployFileDeleteResponse(auth.workspace, filePath);
		}
		return new Response("Method not allowed.", { status: 405 });
	}
```

Add the import near the other `./` imports:

```ts
import {
	deployFileDeleteResponse,
	deployFilesSnapshotResponse,
	deployFileWriteResponse,
	parseDeployFilePath,
} from "./deploy-files";
```

Note: one 400 nuance — a raw suffix whose percent-decoding yields a traversal (e.g. `%2e%2e`) fails `deployFilePathSchema` and 400s here, which is what the traversal test asserts. The `resolveInProject` check inside the handlers is defense in depth, not the primary gate.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test apps/control/src/__tests__/deploy-files.test.ts`
Expected: PASS (all tests). Then run the full control suite: `bun run test` — no regressions.

- [ ] **Step 6: Commit**

```bash
bun run check:fix
git add packages/contracts apps/control
git commit -m "control: add deploy-files API for PathPlanner"
```

---

### Task 3: Serve the PathPlanner build at /pathplanner/

**Files:**
- Modify: `apps/control/src/config.ts` (add `pathplannerDistDir`)
- Modify: `apps/control/src/app/assets.ts` (add `pathplannerResponse`)
- Modify: `apps/control/src/app.ts` (route + noisy-log entry)
- Modify: `apps/control/src/__tests__/helpers.ts` (dist fixture)
- Test: `apps/control/src/__tests__/deploy-files.test.ts` (append a describe block) or extend `routing.test.ts` — use a new describe in `deploy-files.test.ts` to keep the feature's tests together.

**Interfaces:**
- Consumes: `staticFileResponse`, `safeRelativeAssetPath` (existing, in `assets.ts`), `htmlResponse`.
- Produces: `pathplannerResponse(storage: AppStorage, pathname: string): Promise<Response>`; config key `pathplannerDistDir` (env `FRC_PATHPLANNER_DIST_DIR`, default `<repo>/dist/pathplanner`); test fixture `createPathPlannerDist(root)` wired into `withApp`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/control/src/__tests__/deploy-files.test.ts`:

```ts
describe("GET /pathplanner/", () => {
	test("serves the built app without auth (like /scope)", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const index = await app.fetch(
					new Request("http://localhost/pathplanner/"),
				);
				expect(index.status).toBe(200);
				expect(await index.text()).toContain("PathPlanner test dist");

				const js = await app.fetch(
					new Request("http://localhost/pathplanner/main.dart.js"),
				);
				expect(js.status).toBe(200);

				// The iframe URL carries a query string; static serving ignores it.
				const withQuery = await app.fetch(
					new Request("http://localhost/pathplanner/?ws=alice"),
				);
				expect(withQuery.status).toBe(200);
			},
			{ dockerRunner: docker.runner },
		);
	});

	test("rejects traversal outside the dist dir", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const resp = await app.fetch(
					new Request("http://localhost/pathplanner/%2e%2e/secrets"),
				);
				expect(resp.status).toBe(400);
			},
			{ dockerRunner: docker.runner },
		);
	});

	test("503s the index when the dist is absent", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const resp = await app.fetch(
					new Request("http://localhost/pathplanner/"),
				);
				expect(resp.status).toBe(503);
			},
			{
				dockerRunner: docker.runner,
				pathplannerDistDir: "/nonexistent-pathplanner-dist",
			},
		);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test apps/control/src/__tests__/deploy-files.test.ts`
Expected: FAIL — `/pathplanner/` is unrouted (404), and `pathplannerDistDir` is not a known option (typecheck may fail first — that is the same signal).

- [ ] **Step 3: Add the config entry**

In `apps/control/src/config.ts`: add to the `ControlConfig` type, next to `advantageScopeDistDir`:

```ts
	pathplannerDistDir: string;
```

and to the resolver, next to the `advantageScopeDistDir` entry:

```ts
		pathplannerDistDir: resolve(
			input.pathplannerDistDir ??
				Bun.env.FRC_PATHPLANNER_DIST_DIR ??
				resolve(repoRoot, "dist", "pathplanner"),
		),
```

If the input type is separately declared (rather than a `Partial` of the config), mirror `advantageScopeDistDir` there too — follow the compiler.

- [ ] **Step 4: Add the response helper and route**

In `apps/control/src/app/assets.ts`, after `scopeResponse`:

```ts
export async function pathplannerResponse(
	storage: AppStorage,
	pathname: string,
): Promise<Response> {
	let suffix =
		pathname === "/pathplanner" ? "" : pathname.slice("/pathplanner/".length);
	if (suffix === "" || suffix === "/") {
		suffix = "index.html";
	}

	let assetPath: string;
	try {
		assetPath = decodeURIComponent(suffix);
	} catch {
		return new Response("Invalid PathPlanner asset path.", { status: 400 });
	}
	const safePath = safeRelativeAssetPath(assetPath);
	if (!safePath) {
		return new Response("Invalid PathPlanner asset path.", { status: 400 });
	}

	const response = await staticFileResponse(
		storage.config.pathplannerDistDir,
		safePath,
	);
	if (response.status === 404 && safePath === "index.html") {
		return htmlResponse(
			"PathPlanner has not been fetched yet. Run `bun scripts/fetch-dist.ts` (or rebuild the control image) to install the PathPlanner web dist.",
			{ status: 503 },
		);
	}
	return response;
}
```

In `apps/control/src/app.ts`, next to the `/scope` block in `dispatch` (public GET, same reasoning — the app inside calls only cookie-authenticated APIs):

```ts
		if (
			(url.pathname === "/pathplanner" ||
				url.pathname.startsWith("/pathplanner/")) &&
			request.method === "GET"
		) {
			return pathplannerResponse(storage, url.pathname);
		}
```

Add `pathplannerResponse` to the existing import from `./app/assets`, add `"/pathplanner"` to the comment listing public routes above the default-deny marker, and add `url.pathname.startsWith("/pathplanner/")` to the `isNoisy` list next to the `/scope/` entry.

- [ ] **Step 5: Add the test fixture**

In `apps/control/src/__tests__/helpers.ts`, after `createAdvantageScopeDist`:

```ts
export async function createPathPlannerDist(root: string): Promise<string> {
	const pathplannerDistDir = join(root, "pathplanner-dist");
	await mkdir(pathplannerDistDir, { recursive: true });
	await writeFile(
		join(pathplannerDistDir, "index.html"),
		'<!doctype html><html><head><base href="/pathplanner/"><script src="main.dart.js" defer></script></head><body>PathPlanner test dist</body></html>',
		"utf8",
	);
	await writeFile(
		join(pathplannerDistDir, "main.dart.js"),
		"console.log('pathplanner');\n",
		"utf8",
	);
	return pathplannerDistDir;
}
```

And in `withApp`, mirror the other dists:

```ts
	const pathplannerDistDir = await createPathPlannerDist(root);
```

passed to `createApp` as `pathplannerDistDir,` alongside `advantageScopeDistDir` (options spread still lets a test override it, which the 503 test relies on).

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test apps/control/src/__tests__/deploy-files.test.ts` then `bun run test` and `bun run typecheck`.
Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
bun run check:fix
git add apps/control
git commit -m "control: serve the PathPlanner web dist at /pathplanner/"
```

---

### Task 4: Metrics route templating

Without templates, `/u/:slug/api/deploy-files/<every filename>` and `/pathplanner/<every asset>` would each become a distinct metric label value. Unknown paths already collapse safely (`/u/:slug/*`, `other`), so this task is about useful, bounded labels.

**Files:**
- Modify: `apps/control/src/metrics.ts`
- Test: `apps/control/src/__tests__/metrics.test.ts`

**Interfaces:**
- Consumes/produces: `templateRoute(path: string): string` (existing signature unchanged).

- [ ] **Step 1: Write the failing tests**

In `apps/control/src/__tests__/metrics.test.ts`, find the existing `templateRoute` describe/tests and add cases in the same style:

```ts
	test("templates PathPlanner routes with bounded cardinality", () => {
		expect(templateRoute("/pathplanner")).toBe("/pathplanner");
		expect(templateRoute("/pathplanner/")).toBe("/pathplanner/*");
		expect(templateRoute("/pathplanner/main.dart.js")).toBe("/pathplanner/*");
		expect(templateRoute("/u/alice/api/deploy-files/snapshot")).toBe(
			"/u/:slug/api/deploy-files/snapshot",
		);
		expect(
			templateRoute(
				"/u/alice/api/deploy-files/src/main/deploy/pathplanner/paths/A.path",
			),
		).toBe("/u/:slug/api/deploy-files/*");
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test apps/control/src/__tests__/metrics.test.ts`
Expected: FAIL (falls through to `/u/:slug/*` / `other`).

- [ ] **Step 3: Implement**

In `apps/control/src/metrics.ts`:
- Add `"/pathplanner"` to `KNOWN_TOP_LEVEL`.
- Add `"/api/deploy-files/snapshot"` to `KNOWN_WORKSPACE_SUFFIXES`.
- After the `/scope/` prefix rule in `templateRoute`, add:

```ts
	if (path.startsWith("/pathplanner/")) return "/pathplanner/*";
```

- Inside the workspace branch, after the `KNOWN_WORKSPACE_SUFFIXES` check and before the `/u/:slug/*` fallback, add:

```ts
		if (suffix.startsWith("/api/deploy-files/"))
			return "/u/:slug/api/deploy-files/*";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test apps/control/src/__tests__/metrics.test.ts` then `bun run test`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
bun run check:fix
git add apps/control
git commit -m "control: template PathPlanner routes in metrics"
```

---

### Task 5: Packaging — fetch-dist artifact and control-image stage

The dist is a prebuilt `pathplanner-dist.tar.gz` published on the pathplanner-web fork's GitHub releases (tarball contents = the `build/web/` directory contents, `index.html` at tarball root). Flutter never enters this repo's toolchain. **The pathplanner-web release workflow does not exist yet** — both consumers below must therefore degrade gracefully (fetch prints a skip warning; the image builds with an empty dist and `/pathplanner/` 503s), and this task's tests are the graceful paths.

**Files:**
- Modify: `scripts/fetch-dist.ts`
- Modify: `containers/control/Dockerfile`

**Interfaces:**
- Consumes: config default `<repo>/dist/pathplanner` (Task 3) — which inside the image resolves to `/app/dist/pathplanner`.
- Produces: `dist/pathplanner/` populated locally by `bun scripts/fetch-dist.ts`; a `pathplanner-dist` layer in the control image.

- [ ] **Step 1: Extend fetch-dist**

In `scripts/fetch-dist.ts`:

(a) Extend the artifact type and list — PathPlanner comes from a different repo than the CodeRunner release artifacts, and is optional until its first release exists:

```ts
type Artifact = {
	asset: string;
	destDir: string;
	/** Overrides the CodeRunner release repo/tag (PathPlanner ships its own). */
	repo?: string;
	tag?: string;
	/** Print a warning instead of failing when the asset is missing. */
	optional?: boolean;
};

const artifacts: Artifact[] = [
	{
		asset: "ascope-dist.tar.gz",
		destDir: resolve(repoRoot, "dist/advantagescope"),
	},
	{ asset: "web-dist.tar.gz", destDir: resolve(repoRoot, "apps/web/dist") },
	{
		asset: "pathplanner-dist.tar.gz",
		destDir: resolve(repoRoot, "dist/pathplanner"),
		repo: Bun.env.PATHPLANNER_RELEASE_REPO ?? "mathewdunne/pathplanner-web",
		tag: Bun.env.PATHPLANNER_RELEASE_TAG ?? "",
		optional: true,
	},
];
```

(b) Make `downloadUrl` artifact-aware:

```ts
function downloadUrl(artifact: Artifact): string {
	const artifactRepo = artifact.repo ?? repo;
	const artifactTag = artifact.repo ? (artifact.tag ?? "") : tag;
	const base = `https://github.com/${artifactRepo}/releases`;
	return artifactTag
		? `${base}/download/${artifactTag}/${artifact.asset}`
		: `${base}/latest/download/${artifact.asset}`;
}
```

(c) In `fetchAndExtract`, change `const url = downloadUrl(artifact.asset);` to `const url = downloadUrl(artifact);`, and honor `optional` on a failed download:

```ts
	if (!response.ok) {
		const message =
			`Failed to download ${artifact.asset}: ${response.status} ${response.statusText}.`;
		if (artifact.optional) {
			console.warn(`${message} Skipping (optional artifact).`);
			return;
		}
		throw new Error(
			`${message} Check that the release exists and includes this asset.`,
		);
	}
```

(Keep the existing error's repo/tag hint wording for the required artifacts if you prefer — the shape above is the minimum change.)

- [ ] **Step 2: Verify the script degrades gracefully**

Run: `bun scripts/fetch-dist.ts`
Expected: web/ascope artifacts download as before (needs network + an existing CodeRunner release; if offline, at minimum `bun run typecheck` must pass); the PathPlanner artifact prints the skip warning since no pathplanner-web release exists yet. `dist/pathplanner` may be absent — that is fine.

- [ ] **Step 3: Add the Dockerfile stage**

In `containers/control/Dockerfile`, after the `ascope-dist` stage:

```dockerfile
# ── Stage 3b: PathPlanner web dist ─────────────────────────────────────
# Prebuilt in the pathplanner-web fork's CI (Flutter stays out of this
# image, same reasoning as the prebuilt ascope-dist build context). The
# download is best-effort until that fork publishes its first release:
# on failure the dist stays empty and /pathplanner/ serves a 503 telling
# the operator to rebuild once the release exists.
FROM debian:bookworm-slim AS pathplanner-dist
ARG PATHPLANNER_DIST_URL=https://github.com/mathewdunne/pathplanner-web/releases/latest/download/pathplanner-dist.tar.gz
RUN apt-get update -qq \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /pathplanner-dist \
    && { curl -fsSL "$PATHPLANNER_DIST_URL" -o /tmp/pathplanner-dist.tar.gz \
         && tar -xzf /tmp/pathplanner-dist.tar.gz -C /pathplanner-dist \
         || echo "WARNING: PathPlanner dist unavailable; /pathplanner will 503"; }
```

And in the runtime stage, next to `COPY --from=ascope-dist / dist/advantagescope`:

```dockerfile
COPY --from=pathplanner-dist /pathplanner-dist dist/pathplanner
```

(`WORKDIR /app` + the Task 3 default `resolve(repoRoot, "dist", "pathplanner")` → `/app/dist/pathplanner`, so no new env var is needed.)

- [ ] **Step 4: Verify the image builds**

Run: `bun run docker:build:control`
Expected: build succeeds (with the WARNING line from the pathplanner-dist stage until the fork publishes a release). If local Docker builds are too slow to run here, at minimum `docker build --target pathplanner-dist -f containers/control/Dockerfile .` must succeed.

- [ ] **Step 5: Commit**

```bash
bun run check:fix
git add scripts/fetch-dist.ts containers/control/Dockerfile
git commit -m "build: package the PathPlanner web dist via release tarball"
```

---

### Task 6: Web-shell UI components (written + tested, NOT wired)

Two components modeled on `ScopePane.tsx`, plus tests. They stay out of the component tree: `WorkspacePage.tsx` gets only a TODO comment showing the intended wiring. Both panes stay mounted when hidden — PathPlanner's iframe holds an in-memory working copy and a sync queue; unmounting would discard them.

**Files:**
- Create: `apps/web/src/components/PathPlannerPane.tsx`
- Create: `apps/web/src/components/SimPaneSwitcher.tsx`
- Test: `apps/web/src/components/PathPlannerPane.test.tsx`
- Test: `apps/web/src/components/SimPaneSwitcher.test.tsx`
- Modify: `apps/web/src/routes/WorkspacePage.tsx` (comment only)

**Interfaces:**
- Consumes: nothing new (slug arrives as a prop; `WorkspacePage` already has `simSlug`).
- Produces: `PathPlannerPane` (props `{ workspaceSlug: string | null }`, forwards an iframe ref) and `SimPaneSwitcher` (props `{ scope: ReactNode; pathplanner: ReactNode }`).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/components/PathPlannerPane.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { PathPlannerPane } from "./PathPlannerPane";

describe("PathPlannerPane", () => {
	test("renders the iframe pointed at the workspace's PathPlanner URL", () => {
		render(<PathPlannerPane workspaceSlug="alice" />);
		const frame = screen.getByTitle<HTMLIFrameElement>("PathPlanner");
		expect(frame).toBeInTheDocument();
		expect(frame.getAttribute("src")).toBe("/pathplanner/?ws=alice");
	});

	test("shows the loading overlay until the iframe loads", () => {
		render(<PathPlannerPane workspaceSlug="alice" />);
		expect(screen.getByText(/Loading PathPlanner/)).toBeInTheDocument();

		fireEvent.load(screen.getByTitle("PathPlanner"));
		expect(screen.queryByText(/Loading PathPlanner/)).toBeNull();
	});

	test("renders no iframe without a slug", () => {
		render(<PathPlannerPane workspaceSlug={null} />);
		expect(screen.queryByTitle("PathPlanner")).toBeNull();
		expect(screen.getByText(/Loading PathPlanner/)).toBeInTheDocument();
	});
});
```

Create `apps/web/src/components/SimPaneSwitcher.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { SimPaneSwitcher } from "./SimPaneSwitcher";

describe("SimPaneSwitcher", () => {
	afterEach(() => {
		sessionStorage.clear();
	});

	test("defaults to the AdvantageScope tab with both panes mounted", () => {
		render(
			<SimPaneSwitcher
				scope={<div>scope-pane</div>}
				pathplanner={<div>pathplanner-pane</div>}
			/>,
		);

		// Both stay mounted so the hidden iframe keeps its state.
		expect(screen.getByText("scope-pane")).toBeInTheDocument();
		expect(screen.getByText("pathplanner-pane")).toBeInTheDocument();

		expect(
			screen.getByRole("tab", { name: "AdvantageScope" }),
		).toHaveAttribute("aria-selected", "true");
		expect(screen.getByText("pathplanner-pane").parentElement).toHaveProperty(
			"hidden",
			true,
		);
	});

	test("switches tabs and persists the choice", () => {
		render(
			<SimPaneSwitcher
				scope={<div>scope-pane</div>}
				pathplanner={<div>pathplanner-pane</div>}
			/>,
		);

		fireEvent.click(screen.getByRole("tab", { name: "PathPlanner" }));

		expect(screen.getByRole("tab", { name: "PathPlanner" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		expect(screen.getByText("scope-pane").parentElement).toHaveProperty(
			"hidden",
			true,
		);
		expect(screen.getByText("pathplanner-pane").parentElement).toHaveProperty(
			"hidden",
			false,
		);
		expect(sessionStorage.getItem("coderunner:sim-pane-tab")).toBe(
			"pathplanner",
		);
	});

	test("restores the persisted tab", () => {
		sessionStorage.setItem("coderunner:sim-pane-tab", "pathplanner");
		render(
			<SimPaneSwitcher
				scope={<div>scope-pane</div>}
				pathplanner={<div>pathplanner-pane</div>}
			/>,
		);
		expect(screen.getByRole("tab", { name: "PathPlanner" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test:web -- --run PathPlannerPane SimPaneSwitcher` (or plain `bun run test:web`)
Expected: FAIL — components do not exist.

- [ ] **Step 3: Implement `PathPlannerPane.tsx`**

```tsx
import { Loader2 } from "lucide-react";
import { forwardRef, useCallback, useState } from "react";

interface PathPlannerPaneProps {
	workspaceSlug: string | null;
}

/**
 * Iframe host for the PathPlanner web build served at /pathplanner/. The
 * app inside reads `?ws=<slug>` to address its deploy-files API base; the
 * session cookie (same origin) authenticates those calls.
 *
 * NOTE: not yet mounted anywhere — see TODO(pathplanner) in WorkspacePage.
 */
export const PathPlannerPane = forwardRef<
	HTMLIFrameElement,
	PathPlannerPaneProps
>(function PathPlannerPane({ workspaceSlug }, ref) {
	const [iframeLoaded, setIframeLoaded] = useState(false);
	const handleLoad = useCallback(() => setIframeLoaded(true), []);

	return (
		<aside className="relative flex h-full min-h-0 min-w-0 flex-col border-l border-border bg-card">
			{workspaceSlug !== null && (
				<iframe
					ref={ref}
					title="PathPlanner"
					data-pane="pathplanner"
					src={`/pathplanner/?ws=${encodeURIComponent(workspaceSlug)}`}
					className="min-h-0 w-full flex-1 border-0 bg-white"
					onLoad={handleLoad}
				/>
			)}
			{(!iframeLoaded || workspaceSlug === null) && (
				<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card">
					<Loader2 className="size-8 animate-spin text-muted-foreground" />
					<span className="font-mono text-sm text-muted-foreground">
						Loading PathPlanner…
					</span>
				</div>
			)}
		</aside>
	);
});
```

- [ ] **Step 4: Implement `SimPaneSwitcher.tsx`**

```tsx
import type { ReactNode } from "react";
import { useCallback, useState } from "react";

type SimPaneTab = "scope" | "pathplanner";

const STORAGE_KEY = "coderunner:sim-pane-tab";

function readStoredTab(): SimPaneTab {
	try {
		return sessionStorage.getItem(STORAGE_KEY) === "pathplanner"
			? "pathplanner"
			: "scope";
	} catch {
		return "scope";
	}
}

interface SimPaneSwitcherProps {
	scope: ReactNode;
	pathplanner: ReactNode;
}

/**
 * Tab toggle for the right-hand sim pane: AdvantageScope or PathPlanner.
 * Both children stay mounted — the hidden PathPlanner iframe holds an
 * in-memory working copy and a save queue that unmounting would discard.
 *
 * NOTE: not yet mounted anywhere — see TODO(pathplanner) in WorkspacePage.
 */
export function SimPaneSwitcher({ scope, pathplanner }: SimPaneSwitcherProps) {
	const [active, setActive] = useState<SimPaneTab>(readStoredTab);

	const select = useCallback((tab: SimPaneTab) => {
		setActive(tab);
		try {
			sessionStorage.setItem(STORAGE_KEY, tab);
		} catch {
			// Session storage unavailable (private mode); the toggle still works.
		}
	}, []);

	const tabClass = (selected: boolean) =>
		`px-3 py-1.5 text-[12px] font-medium border-b-2 ${
			selected
				? "border-primary text-foreground"
				: "border-transparent text-muted-foreground hover:text-foreground"
		}`;

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				role="tablist"
				aria-label="Simulation pane"
				className="flex shrink-0 border-b border-border bg-card"
			>
				<button
					type="button"
					role="tab"
					aria-selected={active === "scope"}
					className={tabClass(active === "scope")}
					onClick={() => select("scope")}
				>
					AdvantageScope
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={active === "pathplanner"}
					className={tabClass(active === "pathplanner")}
					onClick={() => select("pathplanner")}
				>
					PathPlanner
				</button>
			</div>
			<div className="min-h-0 flex-1" hidden={active !== "scope"}>
				{scope}
			</div>
			<div className="min-h-0 flex-1" hidden={active !== "pathplanner"}>
				{pathplanner}
			</div>
		</div>
	);
}
```

- [ ] **Step 5: Add the TODO comment in `WorkspacePage.tsx`**

Directly above the `scope={<ScopePane ref={scopeFrameRef} />}` line in the `IDELayout` call, add (no other change):

```tsx
				// TODO(pathplanner): once the PathPlanner integration ships
				// end-to-end (pathplanner-web build published + verified against the
				// deploy-files API), swap this pane for the tabbed switcher:
				//   scope={
				//     <SimPaneSwitcher
				//       scope={<ScopePane ref={scopeFrameRef} />}
				//       pathplanner={<PathPlannerPane workspaceSlug={simSlug} />}
				//     />
				//   }
				// Components + tests already exist: SimPaneSwitcher.tsx,
				// PathPlannerPane.tsx.
```

(If Biome objects to a comment in that JSX position, place it immediately above the `<IDELayout` element instead.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun run test:web`
Expected: new tests PASS; existing frontend tests unaffected. Also `bun run typecheck`.

- [ ] **Step 7: Commit**

```bash
bun run check:fix
git add apps/web
git commit -m "web: add dormant PathPlanner pane and sim-pane switcher"
```

---

### Task 7: Decision log, docs pointer, and final verification

**Files:**
- Create: `docs/decisions/038-pathplanner-integration.md`
- Modify: `AGENTS.md` (one line)
- Test: full verify.

- [ ] **Step 1: Write the decision log**

Create `docs/decisions/038-pathplanner-integration.md`:

```markdown
# 038 — PathPlanner integration (deploy-files API + dormant UI)

**Status:** accepted · **Date:** 2026-08-30

## Context

Students should be able to edit PathPlanner paths/autos in the browser IDE.
A fork (`mathewdunne/pathplanner-web`) adapts the Flutter GUI to the web:
it hydrates an in-memory copy of the project's deploy tree over HTTP and
mirrors every mutation back. Design spec and implementation plan live in
that repo (`docs/superpowers/specs/2026-08-30-coderunner-web-design.md`).

## Decision

- **Deploy-files API** (additive, `/u/:slug/api/deploy-files/...` behind
  `requireWorkspaceOwnership`): one `snapshot` GET returning every file
  under `src/main/deploy/pathplanner/**` (read-write) and
  `src/main/deploy/choreo/**` (read-only), plus per-file PUT/DELETE
  restricted to the pathplanner subtree. Paths are validated by a shared
  contracts schema (safe segments, no dotfiles, 512 max); files are capped
  at 5 MB. DELETE of a missing file is 404 (the client treats it as
  success). No rename op — the client decomposes to PUT + DELETE.
- **Serving**: the Flutter web build is static-served at `/pathplanner/`
  (public GET like `/scope/`; identity comes from the session cookie on
  the API calls the embedded app makes). The shell iframes
  `/pathplanner/?ws=<slug>`.
- **Packaging**: a prebuilt `pathplanner-dist.tar.gz` from the fork's
  GitHub releases — fetched by `scripts/fetch-dist.ts` (optional artifact)
  and baked into the control image by a best-effort Dockerfile stage.
  Flutter never enters this repo's toolchain. Until the fork publishes a
  release, `/pathplanner/` serves a 503 and everything else is unaffected.
- **UI is dormant**: `PathPlannerPane` and `SimPaneSwitcher` exist with
  tests but are not mounted; `WorkspacePage` carries a TODO(pathplanner)
  with the exact wiring. Both panes stay mounted when hidden so the
  PathPlanner iframe keeps its in-memory working copy.

## Consequences

- External edits (VSCodium, lesson load, imports) reach PathPlanner only
  on iframe reload — accepted for v1; the shell should reload the iframe
  on project swaps when the UI is wired.
- NT4 telemetry/hot-reload is deferred: the NT4 proxy pins the upstream
  client name to `AdvantageScopeLite`, so a second client needs a name
  passthrough (recorded in the fork's spec).
- User/operator docs land together with the UI wiring, not before.
```

- [ ] **Step 2: Update the AGENTS.md decisions reference**

In `AGENTS.md`, Key References section, change `(011–037 active; …)` to `(011–038 active; …)`.

- [ ] **Step 3: Full verification**

```bash
bun run check:fix
bun run typecheck
bun run test
bun run test:web
graphify update .
```

Expected: all clean/passing.

- [ ] **Step 4: Commit**

```bash
git add docs/decisions/038-pathplanner-integration.md AGENTS.md graphify-out
git commit -m "docs: record PathPlanner integration decision (038)"
```

---

## Out of scope (recorded, do not implement)

- **pathplanner-web release workflow**: the fork needs a CI workflow that runs `flutter build web -t lib/coderunner/main_coderunner.dart --base-href /pathplanner/ --no-web-resources-cdn` and uploads `pathplanner-dist.tar.gz` (tar of `build/web/`'s contents) to its GitHub releases. Belongs in the pathplanner-web repo's plan/backlog.
- **Wiring the UI**: replacing the ScopePane with `SimPaneSwitcher` in `WorkspacePage` (plus reloading the PathPlanner iframe on project swap, E2E specs, and user docs) happens after an end-to-end manual verification against a real PathPlanner build.
- **NT4 telemetry passthrough** for a second client name on the NT4 proxy.
- **deploy.yml / release.yml changes**: the image build pulls the PathPlanner tarball itself; CodeRunner's own release artifacts are unchanged.
