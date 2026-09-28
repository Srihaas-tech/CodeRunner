/**
 * Preview in a `plain-java` console lesson.
 *
 * These lessons have no simulation, so they hide the whole right pane and the
 * Driver Station. Their instructions and test reports are still worth reading,
 * so Preview gets a show/hide button in the topbar's selector slot — and
 * revealing it must not drag any simulation chrome back in with it.
 */
import type { Page } from "@playwright/test";
import type { ControlApp } from "../../../apps/control/src/app";
import { expect, test } from "../../fixtures/app";
import { loginAs } from "../../fixtures/auth";
import { seedPreviewProject } from "../../fixtures/preview-project";

function makeConsoleLesson(app: ControlApp, workspaceId: string): void {
	app.storage.db
		.query(
			"UPDATE workspaces SET current_module = ?, current_module_kind = ? WHERE id = ?",
		)
		.run("hello-world", "plain-java", workspaceId);
}

function previewFrame(page: Page) {
	return page.frameLocator('[data-testid="preview-frame"]');
}

test("a console lesson hides Preview until the student asks for it", async ({
	page,
	app,
	baseURL,
}) => {
	const login = await loginAs(page, app, { name: "console" });
	const workspace = app.storage.findWorkspaceBySlug(login.user.slug);
	await seedPreviewProject(workspace?.project_path ?? "");
	makeConsoleLesson(app, workspace?.id ?? "");

	await page.goto(`${baseURL}/u/${login.user.slug}/`);

	// The lesson's own chrome: a Run hint, and no simulation UI at all.
	await expect(page.locator('[data-pane="console-hint"]')).toBeVisible();
	await expect(page.getByRole("tab", { name: "AdvantageScope" })).toHaveCount(
		0,
	);
	await expect(page.getByRole("tab", { name: "PathPlanner" })).toHaveCount(0);
	await expect(page.locator('[data-pane="console"]')).not.toBeVisible();

	// Preview is offered, but closed.
	const toggle = page.getByRole("button", { name: "Preview", exact: true });
	await expect(toggle).toBeVisible();
	await expect(toggle).toHaveAttribute("aria-pressed", "false");
	await expect(page.locator('[data-pane="preview"]')).not.toBeVisible();

	await toggle.click();

	// Only the Preview pane appears — no Driver Station, no AS/PP.
	await expect(toggle).toHaveAttribute("aria-pressed", "true");
	await expect(previewFrame(page).locator("h1").first()).toHaveText(
		"Robot Project",
	);
	await expect(page.locator('[data-pane="console"]')).not.toBeVisible();
	await expect(page.getByRole("tab", { name: "AdvantageScope" })).toHaveCount(
		0,
	);
	// The Run hint survives alongside it.
	await expect(page.locator('[data-pane="console-hint"]')).toBeVisible();

	// And it hides again.
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-pressed", "false");
	await expect(page.locator('[data-pane="preview"]')).not.toBeVisible();
});

test("a console lesson starts no simulation traffic when Preview opens", async ({
	page,
	app,
	baseURL,
}) => {
	const login = await loginAs(page, app, { name: "quiet" });
	const workspace = app.storage.findWorkspaceBySlug(login.user.slug);
	await seedPreviewProject(workspace?.project_path ?? "");
	makeConsoleLesson(app, workspace?.id ?? "");

	const simRequests: string[] = [];
	page.on("request", (request) => {
		const path = new URL(request.url()).pathname;
		if (/\/(sim|ws\/run|ws\/gamepad)/.test(path)) simRequests.push(path);
	});

	await page.goto(`${baseURL}/u/${login.user.slug}/`);
	await expect(
		page.getByRole("button", { name: "Preview", exact: true }),
	).toBeVisible();

	// The shell cannot know the lesson kind until /api/session answers, so a
	// couple of sim polls fire during the initial load and then stop. That is
	// pre-existing console-lesson behaviour; the claim under test is that
	// *opening Preview* adds nothing to it.
	await page.waitForTimeout(500);
	const beforePreview = [...simRequests];

	await page.getByRole("button", { name: "Preview", exact: true }).click();
	await expect(previewFrame(page).locator("h1").first()).toHaveText(
		"Robot Project",
	);
	await page.getByRole("button", { name: "Refresh" }).click();
	await page.waitForTimeout(500);

	// Preview reads files; it must not wake the simulator hooks this lesson
	// deliberately leaves switched off.
	expect(simRequests).toEqual(beforePreview);
});
