/**
 * Preview isolation. Project HTML is student-authored, executable content that
 * the control plane serves from the app's own origin, so the boundary around it
 * is the security property that matters most in this feature.
 *
 * Covered here: the shell is unreachable from a report; a report URL opened
 * directly is isolated just the same; and no preview URL reaches another
 * student's files.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PreviewDocumentsResponse } from "@frc-coderunner/contracts";
import { expect, test } from "../../fixtures/app";
import { loginAs } from "../../fixtures/auth";
import { seedPreviewProject } from "../../fixtures/preview-project";

/** A report that actively tries to escape, rather than a benign one. */
const HOSTILE_REPORT = `<!doctype html>
<html><body>
<p id="result">idle</p>
<script>
  window.__probe = function (label, fn) {
    try { return label + ":reachable:" + String(fn()); }
    catch (e) { return label + ":blocked:" + e.name; }
  };
</script>
</body></html>
`;

async function documentsFor(
	page: import("@playwright/test").Page,
	baseURL: string,
	slug: string,
): Promise<PreviewDocumentsResponse> {
	const response = await page.request.get(
		`${baseURL}/u/${slug}/api/preview/documents`,
	);
	expect(response.status()).toBe(200);
	return (await response.json()) as PreviewDocumentsResponse;
}

function fileUrl(
	baseURL: string,
	slug: string,
	token: string,
	path: string,
): string {
	return `${baseURL}/u/${slug}/api/preview/files/${token}/${path
		.split("/")
		.map(encodeURIComponent)
		.join("/")}`;
}

test("a hostile report cannot reach the shell, its storage, or its cookies", async ({
	page,
	app,
	baseURL,
}) => {
	const login = await loginAs(page, app, { name: "hostile" });
	const workspace = app.storage.findWorkspaceBySlug(login.user.slug);
	const project = workspace?.project_path ?? "";
	await seedPreviewProject(project);
	await writeFile(join(project, "hostile.html"), HOSTILE_REPORT, "utf8");

	// Driven through the real pane, so the frame is configured exactly as a
	// student would see it rather than by the test.
	await page.goto(`${baseURL}/u/${login.user.slug}/`);
	await page.getByRole("tab", { name: "Preview" }).click();
	await page.getByTestId("preview-picker").click();
	await page.getByPlaceholder("Search documents…").fill("hostile");
	await page.getByRole("option").first().click();

	const frame = page.frameLocator('[data-testid="preview-frame"]');
	await expect(frame.locator("#result")).toHaveText("idle");

	const results = await frame.locator("#result").evaluate(() => {
		const probe = (
			window as unknown as {
				__probe: (label: string, fn: () => unknown) => string;
			}
		).__probe;
		return {
			origin: window.origin,
			parentDom: probe("parent", () => window.parent.document.body.innerHTML),
			topLocation: probe("top", () => window.top?.location.href),
			localStorage: probe("storage", () => {
				window.localStorage.setItem("pwn", "1");
				return "wrote";
			}),
			cookies: probe("cookie", () => document.cookie),
		};
	});

	// An opaque origin is what actually contains the report: it is not
	// same-origin with the shell, so none of the shell's state is addressable.
	expect(results.origin).toBe("null");
	expect(results.parentDom).toMatch(/^parent:blocked:/);
	expect(results.topLocation).toMatch(/^top:blocked:/);
	expect(results.localStorage).toMatch(/^storage:blocked:/);
	// document.cookie is either blocked outright or empty; never the session.
	expect(results.cookies).not.toContain("coderunner_session");

	// The shell's own session is untouched by all of that.
	await expect(page.getByTestId("preview-picker")).toBeVisible();
});

test("a report cannot call authenticated control-plane APIs", async ({
	page,
	app,
	baseURL,
}) => {
	const login = await loginAs(page, app, { name: "fetcher" });
	const workspace = app.storage.findWorkspaceBySlug(login.user.slug);
	const project = workspace?.project_path ?? "";
	await seedPreviewProject(project);
	await writeFile(join(project, "hostile.html"), HOSTILE_REPORT, "utf8");

	const { token } = await documentsFor(page, baseURL, login.user.slug);
	await page.goto(`${baseURL}/login`);
	await page.evaluate(
		(url) => {
			const frame = document.createElement("iframe");
			frame.id = "probe";
			frame.setAttribute("sandbox", "allow-scripts");
			frame.src = url;
			document.body.appendChild(frame);
		},
		fileUrl(baseURL, login.user.slug, token, "hostile.html"),
	);

	const handle = await page.waitForSelector("#probe");
	const frame = await handle.contentFrame();
	await frame?.waitForLoadState("domcontentloaded");

	// connect-src 'none' blocks XHR/fetch/WebSocket out of the document.
	for (const target of [
		`${baseURL}/u/${login.user.slug}/api/session`,
		`${baseURL}/u/${login.user.slug}/api/lessons`,
		`${baseURL}/api/auth/providers`,
	]) {
		const result = await frame?.evaluate(async (url) => {
			try {
				const response = await fetch(url, { credentials: "include" });
				return `reachable:${response.status}`;
			} catch (error) {
				return `blocked:${(error as Error).name}`;
			}
		}, target);
		expect(result).toMatch(/^blocked:/);
	}
});

test("a preview URL opened directly is sandboxed and uncacheable", async ({
	page,
	app,
	baseURL,
}) => {
	const login = await loginAs(page, app, { name: "direct" });
	const workspace = app.storage.findWorkspaceBySlug(login.user.slug);
	await seedPreviewProject(workspace?.project_path ?? "");
	const { token } = await documentsFor(page, baseURL, login.user.slug);

	const response = await page.goto(
		fileUrl(
			baseURL,
			login.user.slug,
			token,
			"build/reports/tests/test/index.html",
		),
	);
	expect(response?.status()).toBe(200);

	const headers = response?.headers() ?? {};
	expect(headers["content-security-policy"]).toContain("sandbox allow-scripts");
	expect(headers["content-security-policy"]).not.toContain("allow-same-origin");
	expect(headers["content-security-policy"]).toContain("navigate-to 'none'");
	expect(headers["x-content-type-options"]).toBe("nosniff");
	// Keeps the capability token out of the Referer of any outbound navigation.
	expect(headers["referrer-policy"]).toBe("no-referrer");
	// One student's private files must not sit in a shared cache.
	expect(headers["cache-control"]).toContain("no-store");
	expect(headers["cache-control"]).toContain("private");

	// The header alone, with no iframe involved, still produces an opaque origin.
	expect(await page.evaluate(() => window.origin)).toBe("null");
});

test("no preview route reaches another student's project", async ({
	page,
	app,
	baseURL,
}) => {
	const victim = await loginAs(page, app, { name: "victim" });
	const victimWorkspace = app.storage.findWorkspaceBySlug(victim.user.slug);
	await writeFile(
		join(victimWorkspace?.project_path ?? "", "SECRET.md"),
		"# victim secret\n",
		"utf8",
	);
	const victimDocs = await documentsFor(page, baseURL, victim.user.slug);

	// Now become a different student in the same browser context.
	const attacker = await loginAs(page, app, { name: "attacker" });
	const attackerWorkspace = app.storage.findWorkspaceBySlug(attacker.user.slug);
	await seedPreviewProject(attackerWorkspace?.project_path ?? "");
	const attackerDocs = await documentsFor(page, baseURL, attacker.user.slug);

	// The victim's document list is refused outright.
	const listResponse = await page.request.get(
		`${baseURL}/u/${victim.user.slug}/api/preview/documents`,
	);
	expect(listResponse.status()).toBe(403);

	// The attacker's own token does not open the victim's files...
	const withOwnToken = await page.request.get(
		fileUrl(baseURL, victim.user.slug, attackerDocs.token, "SECRET.md"),
	);
	expect(withOwnToken.status()).toBe(403);
	expect(await withOwnToken.text()).not.toContain("victim secret");

	// ...and the victim's token does not travel to the attacker's slug either.
	const crossSlug = await page.request.get(
		fileUrl(baseURL, attacker.user.slug, victimDocs.token, "README.md"),
	);
	expect(crossSlug.status()).toBe(403);

	// Traversal out of the attacker's own project is refused.
	for (const path of ["../victim/project/SECRET.md", "..%2F..%2Fapp.db"]) {
		const attempt = await page.request.get(
			`${baseURL}/u/${attacker.user.slug}/api/preview/files/${attackerDocs.token}/${path}`,
		);
		expect([400, 403, 404]).toContain(attempt.status());
		expect(await attempt.text()).not.toContain("victim secret");
	}
});
