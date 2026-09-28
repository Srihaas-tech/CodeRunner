import { describe, expect, test } from "bun:test";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
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

	test("caps the aggregate snapshot size, truncating rather than 500ing", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const cookie = cookieFrom(await login(app, "alice"));
				const projectPath = workspaceProjectPath(app, "alice");
				const pathsDir = join(projectPath, PP, "paths");
				await mkdir(pathsDir, { recursive: true });

				// 30 * 1 MiB comfortably exceeds the 25 MiB aggregate cap, while
				// each file stays well under the 5 MiB per-file cap.
				const oneMib = "x".repeat(1024 * 1024);
				for (let i = 0; i < 30; i += 1) {
					await writeFile(join(pathsDir, `Big${i}.path`), oneMib, "utf8");
				}

				const resp = await app.fetch(
					new Request("http://localhost/u/alice/api/deploy-files/snapshot", {
						headers: { cookie },
					}),
				);
				expect(resp.status).toBe(200);
				const body = (await resp.json()) as DeployFilesSnapshotResponse;
				expect(body.ok).toBe(true);
				expect(body.files.length).toBeGreaterThan(0);
				expect(body.files.length).toBeLessThan(30);
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

	test("overwriting a longer file leaves no trailing bytes", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const cookie = cookieFrom(await login(app, "alice"));
				const url = `http://localhost/u/alice/api/deploy-files/${PP}/paths/Overwrite.path`;
				const target = join(
					workspaceProjectPath(app, "alice"),
					PP,
					"paths",
					"Overwrite.path",
				);

				const first = await app.fetch(
					new Request(url, {
						method: "PUT",
						headers: { cookie },
						body: '{"waypoints": [1, 2, 3, 4, 5, 6, 7, 8]}',
					}),
				);
				expect(first.status).toBe(200);

				// The write path opens without O_TRUNC (so a lost symlink race
				// can't destroy a file before the descriptor check runs) and
				// truncates afterwards instead. Drop that truncate and this
				// shorter body would leave the tail of the longer one behind.
				const second = await app.fetch(
					new Request(url, {
						method: "PUT",
						headers: { cookie },
						body: "{}",
					}),
				);
				expect(second.status).toBe(200);
				expect(await readFile(target, "utf8")).toBe("{}");
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
						new Request(`http://localhost/u/alice/api/deploy-files/${path}`, {
							method: "PUT",
							headers: { cookie },
							body: "x",
						}),
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

	test("rejects a symlink as the final path component, leaving the real target unchanged", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app, root) => {
				const cookie = cookieFrom(await login(app, "alice"));
				const projectPath = workspaceProjectPath(app, "alice");
				await mkdir(join(projectPath, PP, "paths"), { recursive: true });

				// A file the control-plane process can write but that lives
				// entirely outside this student's project — the shared DB in
				// spirit, a plain file in practice.
				const outsideFile = join(root, "outside-target.db");
				await writeFile(outsideFile, "untouched", "utf8");

				// Plant a symlink as the final path component: a student with
				// terminal/Gradle-task access to their own container could do
				// exactly this from inside the read-write bind mount.
				const evilPath = join(projectPath, PP, "paths", "Evil.path");
				await symlink(outsideFile, evilPath);

				const resp = await app.fetch(
					new Request(
						`http://localhost/u/alice/api/deploy-files/${PP}/paths/Evil.path`,
						{
							method: "PUT",
							headers: { cookie },
							body: '{"pwned": true}',
						},
					),
				);
				expect(resp.status).toBe(403);

				const outsideContent = await readFile(outsideFile, "utf8");
				expect(outsideContent).toBe("untouched");
			},
			{ dockerRunner: docker.runner },
		);
	});

	test("rejects a directory symlink as an intermediate path component, leaving files outside the project unchanged", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app, root) => {
				const cookie = cookieFrom(await login(app, "alice"));
				const projectPath = workspaceProjectPath(app, "alice");
				await mkdir(join(projectPath, PP), { recursive: true });

				// A directory outside this student's project — could be another
				// student's project root, or any control-plane-writable dir.
				const outsideDir = join(root, "outside-project");
				await mkdir(outsideDir, { recursive: true });
				const victimFile = join(outsideDir, "Victim.path");
				await writeFile(victimFile, "untouched", "utf8");

				// Plant a directory symlink as an intermediate path component.
				const evilDir = join(projectPath, PP, "evil");
				await symlink(outsideDir, evilDir);

				const resp = await app.fetch(
					new Request(
						`http://localhost/u/alice/api/deploy-files/${PP}/evil/Victim.path`,
						{
							method: "PUT",
							headers: { cookie },
							body: '{"pwned": true}',
						},
					),
				);
				expect(resp.status).toBe(403);

				const victimContent = await readFile(victimFile, "utf8");
				expect(victimContent).toBe("untouched");

				// Nothing new should have been created inside the escaped dir.
				const newFile = join(outsideDir, "New.path");
				await expect(readFile(newFile, "utf8")).rejects.toThrow();
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

	test("rejects a symlink as the final path component, leaving the real target unchanged", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app, root) => {
				const cookie = cookieFrom(await login(app, "alice"));
				const projectPath = workspaceProjectPath(app, "alice");
				await mkdir(join(projectPath, PP, "paths"), { recursive: true });

				// A file outside the project that a naive follow-and-delete
				// would unlink, e.g. the shared database in production.
				const outsideFile = join(root, "outside-target.db");
				await writeFile(outsideFile, "untouched", "utf8");

				const evilPath = join(projectPath, PP, "paths", "EvilDelete.path");
				await symlink(outsideFile, evilPath);

				const resp = await app.fetch(
					new Request(
						`http://localhost/u/alice/api/deploy-files/${PP}/paths/EvilDelete.path`,
						{ method: "DELETE", headers: { cookie } },
					),
				);
				expect(resp.status).toBe(403);

				const outsideContent = await readFile(outsideFile, "utf8");
				expect(outsideContent).toBe("untouched");
			},
			{ dockerRunner: docker.runner },
		);
	});
});

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

	// CONTROLLER CORRECTION (binding): the plan originally used
	// "/pathplanner/%2e%2e/secrets" here. The WHATWG URL parser collapses
	// %2e%2e as a dot segment *before routing*, so that pathname arrives as
	// "/secrets" and never reaches pathplannerResponse — the 400 would be
	// unreachable. "..%2fsecrets" is preserved by the parser, decodes to
	// "../secrets", and is rejected by safeRelativeAssetPath. Use it as
	// written below.
	test("rejects traversal outside the dist dir", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const resp = await app.fetch(
					new Request("http://localhost/pathplanner/..%2fsecrets"),
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
