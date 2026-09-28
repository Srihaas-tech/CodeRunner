/**
 * Preview's end-to-end workflow through the real IDE shell: open the pane,
 * read a document, refresh after the files on disk change, switch panes, and
 * replace the project underneath it.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../../fixtures/app";
import { loginAs } from "../../fixtures/auth";
import { seedPreviewProject } from "../../fixtures/preview-project";

const REPORT = "build/reports/tests/test";

async function writeProjectFile(
	projectPath: string,
	relativePath: string,
	contents: string,
): Promise<void> {
	const target = join(projectPath, relativePath);
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, contents, "utf8");
}

async function openWorkspace(page: Page, baseURL: string, slug: string) {
	await page.goto(`${baseURL}/u/${slug}/`);
	await page.getByRole("tab", { name: "Preview" }).click();
}

function previewFrame(page: Page) {
	return page.frameLocator('[data-testid="preview-frame"]');
}

test.describe("preview workflow", () => {
	test("opens the README, then reads a report the student picks", async ({
		page,
		app,
		baseURL,
	}) => {
		const login = await loginAs(page, app, { name: "workflow" });
		const workspace = app.storage.findWorkspaceBySlug(login.user.slug);
		await seedPreviewProject(workspace?.project_path ?? "");

		await openWorkspace(page, baseURL, login.user.slug);

		// The root README opens on its own.
		await expect(previewFrame(page).locator("h1").first()).toHaveText(
			"Robot Project",
		);
		await expect(page.getByTestId("preview-picker")).toHaveText(/README\.md/);

		// Search by folder, then open the generated report.
		await page.getByTestId("preview-picker").click();
		await page.getByPlaceholder("Search documents…").fill("reports test index");
		await page.getByRole("option").first().click();

		await expect(previewFrame(page).locator("#report-heading")).toHaveText(
			"Test Summary",
		);
		await expect(previewFrame(page).locator("#script-output")).toHaveText(
			"script-ran",
		);
	});

	test("Refresh picks up changed HTML, CSS, script and image content", async ({
		page,
		app,
		baseURL,
	}) => {
		const login = await loginAs(page, app, { name: "refresher" });
		const workspace = app.storage.findWorkspaceBySlug(login.user.slug);
		const project = workspace?.project_path ?? "";
		await seedPreviewProject(project);

		await openWorkspace(page, baseURL, login.user.slug);
		await expect(previewFrame(page).locator("h1").first()).toHaveText(
			"Robot Project",
		);

		await page.getByTestId("preview-picker").click();
		await page.getByPlaceholder("Search documents…").fill("reports test index");
		await page.getByRole("option").first().click();
		await expect(previewFrame(page).locator("#report-heading")).toHaveCSS(
			"color",
			"rgb(0, 128, 0)",
		);

		// Regenerate the report on disk: new HTML, new stylesheet, new script.
		await writeProjectFile(
			project,
			`${REPORT}/index.html`,
			`<!doctype html><html><head>
         <link rel="stylesheet" href="css/base.css"/>
         <script src="js/report.js"></script></head>
       <body><h1 id="report-heading">Rebuilt Summary</h1>
         <p id="script-output">no script</p></body></html>`,
		);
		await writeProjectFile(
			project,
			`${REPORT}/css/base.css`,
			"#report-heading { color: rgb(0, 0, 255); }",
		);
		await writeProjectFile(
			project,
			`${REPORT}/js/report.js`,
			`document.addEventListener("DOMContentLoaded", function () {
         document.getElementById("script-output").textContent = "rebuilt-script";
       });`,
		);
		// ...and add a brand new document.
		await writeProjectFile(project, "docs/NEWLY-ADDED.md", "# Newly added\n");

		await page.getByRole("button", { name: "Refresh" }).click();

		// One Refresh reloads the document *and* its assets, not just the HTML.
		await expect(previewFrame(page).locator("#report-heading")).toHaveText(
			"Rebuilt Summary",
		);
		await expect(previewFrame(page).locator("#report-heading")).toHaveCSS(
			"color",
			"rgb(0, 0, 255)",
		);
		await expect(previewFrame(page).locator("#script-output")).toHaveText(
			"rebuilt-script",
		);

		// The new file is immediately selectable.
		await page.getByTestId("preview-picker").click();
		await page.getByPlaceholder("Search documents…").fill("NEWLY-ADDED");
		await expect(page.getByRole("option")).toHaveCount(1);
	});

	test("Refresh returns a scrolled document to the top", async ({
		page,
		app,
		baseURL,
	}) => {
		const login = await loginAs(page, app, { name: "scroller" });
		const workspace = app.storage.findWorkspaceBySlug(login.user.slug);
		const project = workspace?.project_path ?? "";
		const long = Array.from(
			{ length: 400 },
			(_, i) => `Paragraph ${i} with enough text to make the page scroll.`,
		).join("\n\n");
		await seedPreviewProject(project, { readme: `# Long\n\n${long}\n` });

		await openWorkspace(page, baseURL, login.user.slug);
		await expect(previewFrame(page).locator("h1").first()).toHaveText("Long");

		await previewFrame(page)
			.locator("body")
			.evaluate((body: HTMLElement) => {
				body.ownerDocument.defaultView?.scrollTo(0, 2000);
			});
		const scrolled = await previewFrame(page)
			.locator("body")
			.evaluate(
				(body: HTMLElement) => body.ownerDocument.defaultView?.scrollY ?? 0,
			);
		expect(scrolled).toBeGreaterThan(0);

		await page.getByRole("button", { name: "Refresh" }).click();

		// Explicitly the documented behaviour: Refresh starts at the top. There is
		// no scroll-restoration subsystem to test.
		await expect
			.poll(async () =>
				previewFrame(page)
					.locator("body")
					.evaluate(
						(body: HTMLElement) => body.ownerDocument.defaultView?.scrollY ?? 0,
					),
			)
			.toBe(0);
	});

	test("a deleted file is reported and the picker stays usable", async ({
		page,
		app,
		baseURL,
	}) => {
		const login = await loginAs(page, app, { name: "deleter" });
		const workspace = app.storage.findWorkspaceBySlug(login.user.slug);
		const project = workspace?.project_path ?? "";
		await seedPreviewProject(project);

		await openWorkspace(page, baseURL, login.user.slug);
		await expect(previewFrame(page).locator("h1").first()).toHaveText(
			"Robot Project",
		);

		await rm(join(project, "README.md"));
		await page.getByRole("button", { name: "Refresh" }).click();

		await expect(
			page.getByText("README.md is no longer available."),
		).toBeVisible();
		// The refreshed list still works.
		await page.getByTestId("preview-picker").click();
		await page.getByPlaceholder("Search documents…").fill("guide");
		await page.getByRole("option").first().click();
		await expect(previewFrame(page).locator("h1").first()).toHaveText("Guide");
	});

	test("switching to AdvantageScope and back preserves both instances and the selection", async ({
		page,
		app,
		baseURL,
	}) => {
		const login = await loginAs(page, app, { name: "switcher" });
		const workspace = app.storage.findWorkspaceBySlug(login.user.slug);
		await seedPreviewProject(workspace?.project_path ?? "");

		await openWorkspace(page, baseURL, login.user.slug);

		await page.getByTestId("preview-picker").click();
		await page.getByPlaceholder("Search documents…").fill("guide");
		await page.getByRole("option").first().click();
		await expect(previewFrame(page).locator("h1").first()).toHaveText("Guide");

		// The AdvantageScope iframe must survive the round trip, not remount.
		const scopeFrameId = await page
			.locator('[data-pane="scope"] iframe')
			.first()
			.evaluate((el: HTMLIFrameElement) => {
				const tagged = el as HTMLIFrameElement & { __e2eId?: string };
				tagged.__e2eId ??= Math.random().toString(36);
				return tagged.__e2eId;
			});

		await page.getByRole("tab", { name: "AdvantageScope" }).click();
		await page.getByRole("tab", { name: "Preview" }).click();

		await expect(page.getByTestId("preview-picker")).toHaveText(
			/docs\/guide\.md/,
		);
		await expect(previewFrame(page).locator("h1").first()).toHaveText("Guide");

		const afterId = await page
			.locator('[data-pane="scope"] iframe')
			.first()
			.evaluate(
				(el: HTMLIFrameElement) =>
					(el as HTMLIFrameElement & { __e2eId?: string }).__e2eId,
			);
		expect(afterId).toBe(scopeFrameId);
	});

	test("replacing the project clears the old content and selection", async ({
		page,
		app,
		baseURL,
	}) => {
		const login = await loginAs(page, app, { name: "swapper" });
		const workspace = app.storage.findWorkspaceBySlug(login.user.slug);
		const project = workspace?.project_path ?? "";
		await seedPreviewProject(project);

		await openWorkspace(page, baseURL, login.user.slug);
		await expect(previewFrame(page).locator("h1").first()).toHaveText(
			"Robot Project",
		);

		// Stand in for a lesson load / repo import: the project is replaced on
		// disk and the shell is told to invalidate.
		await rm(project, { recursive: true, force: true });
		await writeProjectFile(project, "OTHER.md", "# Other project\n");
		await page.getByRole("button", { name: "Refresh" }).click();

		await expect(
			page.getByText("README.md is no longer available."),
		).toBeVisible();
		await page.getByTestId("preview-picker").click();
		await page.getByPlaceholder("Search documents…").fill("Other");
		await page.getByRole("option").first().click();
		await expect(previewFrame(page).locator("h1").first()).toHaveText(
			"Other project",
		);
	});

	test("truncation is disclosed rather than silently hidden", async ({
		page,
		app,
		baseURL,
	}) => {
		const login = await loginAs(page, app, { name: "many" });
		const workspace = app.storage.findWorkspaceBySlug(login.user.slug);
		const project = workspace?.project_path ?? "";
		await seedPreviewProject(project);
		// The document budget is 2,000; go past it.
		await Promise.all(
			Array.from({ length: 2100 }, (_, i) =>
				writeProjectFile(project, `bulk/doc-${i}.md`, `# Doc ${i}\n`),
			),
		);

		await openWorkspace(page, baseURL, login.user.slug);
		await page.getByTestId("preview-picker").click();

		await expect(
			page.getByText("This project has more documents than Preview lists."),
		).toBeVisible();
	});
});
