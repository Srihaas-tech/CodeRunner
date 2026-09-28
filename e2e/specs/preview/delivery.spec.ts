/**
 * Step 1 of the Preview plan: prove the report delivery model in a real browser
 * before any UI is built on top of it.
 *
 * The thing being proved is that a generated Gradle report renders *correctly*
 * (its own stylesheet, script, image and page links all resolve) from inside a
 * frame that has been stripped of same-origin privileges — and that the report's
 * script, once running, can reach neither the CodeRunner shell nor its
 * authenticated APIs.
 */

import type { PreviewDocumentsResponse } from "@frc-coderunner/contracts";
import type { Frame, Page } from "@playwright/test";
import { expect, test } from "../../fixtures/app";
import { loginAs } from "../../fixtures/auth";
import { seedPreviewProject } from "../../fixtures/preview-project";

async function setUp(
	page: Page,
	app: {
		storage: {
			findWorkspaceBySlug: (s: string) => { project_path: string } | null;
		};
	} & Parameters<typeof loginAs>[1],
) {
	const login = await loginAs(page, app, { name: "previewer" });
	const workspace = app.storage.findWorkspaceBySlug(login.user.slug);
	if (!workspace) throw new Error("workspace missing after login");
	await seedPreviewProject(workspace.project_path);
	return { slug: login.user.slug, projectPath: workspace.project_path };
}

async function fetchDocuments(
	page: Page,
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
	const encoded = path.split("/").map(encodeURIComponent).join("/");
	return `${baseURL}/u/${slug}/api/preview/files/${token}/${encoded}`;
}

/**
 * Mounts the document in a frame configured exactly the way the Preview pane
 * will: sandboxed for scripts, denied same-origin.
 */
async function mountPreviewFrame(page: Page, src: string): Promise<Frame> {
	await page.evaluate((url) => {
		document.querySelector("#preview-probe")?.remove();
		const frame = document.createElement("iframe");
		frame.id = "preview-probe";
		frame.setAttribute("sandbox", "allow-scripts");
		frame.style.cssText = "width:800px;height:600px;border:0";
		frame.src = url;
		document.body.appendChild(frame);
	}, src);
	const handle = await page.waitForSelector("#preview-probe");
	const frame = await handle.contentFrame();
	if (!frame) throw new Error("preview frame did not attach");
	await frame.waitForLoadState("domcontentloaded");
	return frame;
}

test.describe("preview delivery model", () => {
	test("lists project documents and excludes machine trees", async ({
		page,
		app,
		baseURL,
	}) => {
		const { slug } = await setUp(page, app);
		const body = await fetchDocuments(page, baseURL, slug);

		expect(body.ok).toBe(true);
		expect(body.truncated).toBe(false);
		expect(body.token).toMatch(/^p1\.\d+\./);
		expect(body.tokenExpiresIn).toBeGreaterThan(0);

		const paths = body.documents.map((d) => d.path);
		expect(paths).toContain("README.md");
		expect(paths).toContain("docs/guide.md");
		expect(paths).toContain("docs/notes/index.html");
		expect(paths).toContain("build/reports/tests/test/index.html");
		// Generated output is in scope even though it is gitignored.
		expect(paths).toContain(
			"build/reports/tests/test/classes/MyRobotTest.html",
		);
		// Hidden directories are not blanket-excluded.
		expect(paths).toContain(".docs/hidden-notes.md");

		// Excluded trees never appear.
		expect(paths.some((p) => p.startsWith(".git/"))).toBe(false);
		expect(paths.some((p) => p.startsWith(".gradle/"))).toBe(false);
		expect(paths.some((p) => p.startsWith("node_modules/"))).toBe(false);

		// Shallow paths sort above deep ones, so hand-written docs sit above a
		// generated report tree rather than being buried under it.
		expect(paths.indexOf("README.md")).toBeLessThan(
			paths.indexOf("build/reports/tests/test/index.html"),
		);

		// Kinds are classified, case-insensitively by extension.
		const readme = body.documents.find((d) => d.path === "README.md");
		expect(readme?.kind).toBe("markdown");
		const report = body.documents.find(
			(d) => d.path === "build/reports/tests/test/index.html",
		);
		expect(report?.kind).toBe("html");
	});

	test("renders Markdown with no external requests and working anchors", async ({
		page,
		app,
		baseURL,
	}) => {
		const { slug } = await setUp(page, app);
		const { token } = await fetchDocuments(page, baseURL, slug);

		// Fail loudly if anything reaches off-origin: the whole point is that a
		// student behind a school firewall can still read their README.
		const external: string[] = [];
		await page.route("**/*", async (route) => {
			const url = route.request().url();
			if (!url.startsWith(baseURL) && !url.startsWith("data:")) {
				external.push(url);
				await route.abort();
				return;
			}
			await route.continue();
		});

		await page.goto(`${baseURL}/login`);
		const frame = await mountPreviewFrame(
			page,
			fileUrl(baseURL, slug, token, "README.md"),
		);

		await expect(frame.locator("h1")).toHaveText("Robot Project");
		await expect(frame.locator("table td").first()).toHaveText("1");
		await expect(frame.locator("pre code")).toContainText("public class Robot");

		// Stable heading anchors, so the hand-written "#wiring" link resolves.
		expect(await frame.locator("#getting-started").count()).toBe(1);
		expect(await frame.locator("#wiring").count()).toBe(1);

		// The relative image resolves through the token prefix.
		const imageWidth = await frame
			.locator("img")
			.first()
			.evaluate((img: HTMLImageElement) => img.naturalWidth);
		expect(imageWidth).toBeGreaterThan(0);

		// Raw HTML in Markdown is disabled at the parser, and the frame denies
		// scripts anyway, so the embedded <script> is inert twice over.
		expect(await frame.evaluate(() => "__mdRawHtmlRan" in window)).toBe(false);

		expect(external).toEqual([]);
	});

	test("renders a Gradle report with its assets, links and interactivity", async ({
		page,
		app,
		baseURL,
	}) => {
		const { slug } = await setUp(page, app);
		const { token } = await fetchDocuments(page, baseURL, slug);

		await page.goto(`${baseURL}/login`);
		const frame = await mountPreviewFrame(
			page,
			fileUrl(baseURL, slug, token, "build/reports/tests/test/index.html"),
		);

		// Local stylesheet applied.
		await expect(frame.locator("#report-heading")).toHaveCSS(
			"color",
			"rgb(0, 128, 0)",
		);
		// Local classic script ran.
		await expect(frame.locator("#script-output")).toHaveText("script-ran");
		// Local image decoded.
		const logoWidth = await frame
			.locator("#report-logo")
			.evaluate((img: HTMLImageElement) => img.naturalWidth);
		expect(logoWidth).toBeGreaterThan(0);

		// Script-driven interactivity works.
		await frame.locator("#toggle").click();
		await expect(frame.locator("#toggle-output")).toHaveText("open");

		// Page-to-page navigation inside the report, including a parent-relative
		// asset reference on the destination page.
		await frame.locator("#to-class").click();
		await frame.waitForURL(/MyRobotTest\.html/);
		await expect(frame.locator("#report-heading")).toHaveText("MyRobotTest");
		await expect(frame.locator("#report-heading")).toHaveCSS(
			"color",
			"rgb(0, 128, 0)",
		);

		// ...and back again, so the report is navigable in both directions.
		await frame.locator("#to-index").click();
		await frame.waitForURL(/\/index\.html$/);
		await expect(frame.locator("#report-heading")).toHaveText("Test Summary");
	});

	test("report scripts cannot reach the shell, its storage, or its APIs", async ({
		page,
		app,
		baseURL,
	}) => {
		const { slug } = await setUp(page, app);
		const { token } = await fetchDocuments(page, baseURL, slug);

		await page.goto(`${baseURL}/login`);
		const frame = await mountPreviewFrame(
			page,
			fileUrl(baseURL, slug, token, "build/reports/tests/test/index.html"),
		);

		// Opaque origin: the frame is not same-origin with the shell.
		expect(await frame.evaluate(() => window.origin)).toBe("null");

		// Cross-document access into the shell is refused.
		const parentAccess = await frame.evaluate(() => {
			try {
				return window.parent.document.title === undefined
					? "undefined"
					: "reachable";
			} catch (error) {
				return `blocked:${(error as Error).name}`;
			}
		});
		expect(parentAccess).toMatch(/^blocked:/);

		// App storage is partitioned away from an opaque origin.
		const storageAccess = await frame.evaluate(() => {
			try {
				window.localStorage.setItem("x", "1");
				return "reachable";
			} catch (error) {
				return `blocked:${(error as Error).name}`;
			}
		});
		expect(storageAccess).toMatch(/^blocked:/);

		// connect-src 'none' stops the report calling authenticated control APIs.
		const apiAccess = await frame.evaluate(async (url) => {
			try {
				const response = await fetch(url, { credentials: "include" });
				return `reachable:${response.status}`;
			} catch (error) {
				return `blocked:${(error as Error).name}`;
			}
		}, `${baseURL}/u/${slug}/api/session`);
		expect(apiAccess).toMatch(/^blocked:/);
	});

	test("a report URL opened directly is still sandboxed", async ({
		page,
		app,
		baseURL,
	}) => {
		const { slug } = await setUp(page, app);
		const { token } = await fetchDocuments(page, baseURL, slug);

		const url = fileUrl(
			baseURL,
			slug,
			token,
			"build/reports/tests/test/index.html",
		);
		const response = await page.goto(url);
		expect(response?.status()).toBe(200);

		const csp = response?.headers()["content-security-policy"] ?? "";
		expect(csp).toContain("sandbox allow-scripts");
		expect(csp).not.toContain("allow-same-origin");
		expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
		expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
		expect(response?.headers()["cache-control"]).toContain("no-store");

		// The header alone, with no framing involved, produces an opaque origin.
		expect(await page.evaluate(() => window.origin)).toBe("null");
	});
});
