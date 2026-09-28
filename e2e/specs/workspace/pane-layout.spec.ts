/**
 * Pane sizing persists across a reload (sessionStorage), and resets in a new session.
 */
import { expect, test } from "../../fixtures/app";
import { loginAs } from "../../fixtures/auth";
import {
	seedRuntimeRunning,
	seedWorkspaceProject,
} from "../../fixtures/runtime";

test("resized pane sizes survive a reload and reset in a new session", async ({
	page,
	app,
	runtime,
	fakeVscode,
	fakeHalsim,
}) => {
	const session = await loginAs(page, app, { name: "Panes" });
	const workspace = app.storage.findWorkspaceBySlug(
		session.user.slug as never,
	)!;
	await seedWorkspaceProject(workspace.project_path);
	seedRuntimeRunning({
		runtime,
		workspaceId: workspace.id,
		fakeVscode,
		fakeHalsim,
	});

	await page.goto(`/u/${session.user.slug}/`);

	const console_ = page.locator("#ide-console");
	await expect(console_).toBeVisible();
	const defaultHeight = (await console_.boundingBox())!.height;

	// Grow the console pane with the separator's keyboard resize.
	const separator = page.locator(
		'[data-slot="resizable-handle"][aria-orientation="horizontal"]',
	);
	await separator.focus();
	for (let i = 0; i < 10; i++) {
		await separator.press("ArrowUp");
	}

	const resizedHeight = (await console_.boundingBox())!.height;
	expect(resizedHeight).toBeGreaterThan(defaultHeight + 50);

	await page.reload();
	await expect(console_).toBeVisible();
	const restoredHeight = (await console_.boundingBox())!.height;
	expect(Math.abs(restoredHeight - resizedHeight)).toBeLessThan(5);

	// A fresh browser session (new sessionStorage) falls back to the defaults.
	const freshContext = await page.context().browser()!.newContext();
	const freshPage = await freshContext.newPage();
	const freshSession = await loginAs(freshPage, app, { name: "Panes Fresh" });
	const freshWorkspace = app.storage.findWorkspaceBySlug(
		freshSession.user.slug as never,
	)!;
	await seedWorkspaceProject(freshWorkspace.project_path);
	seedRuntimeRunning({
		runtime,
		workspaceId: freshWorkspace.id,
		fakeVscode,
		fakeHalsim,
	});
	await freshPage.goto(`/u/${freshSession.user.slug}/`);
	const freshConsole = freshPage.locator("#ide-console");
	await expect(freshConsole).toBeVisible();
	const freshHeight = (await freshConsole.boundingBox())!.height;
	expect(Math.abs(freshHeight - defaultHeight)).toBeLessThan(5);

	await freshContext.close();
});

test("collapse restores sizes and live frames, survives reload, and has a reset escape hatch", async ({
	page,
	app,
	runtime,
	fakeVscode,
	fakeHalsim,
}) => {
	const { user } = await loginAs(page, app, { name: "Collapse" });
	const workspace = app.storage.findWorkspaceBySlug(user.slug as never)!;
	await seedWorkspaceProject(workspace.project_path);
	seedRuntimeRunning({
		runtime,
		workspaceId: workspace.id,
		fakeVscode,
		fakeHalsim,
	});
	await page.goto(`/u/${user.slug}/`);
	const editor = page.locator('[data-pane="editor"] iframe');
	await expect(editor).toBeVisible();
	const editorBody = editor.contentFrame().locator("body");
	await expect(editorBody).toHaveAttribute("data-fake-vscode-ready", "true");
	await editorBody.evaluate((body) =>
		body.setAttribute("data-layout-sentinel", "alive"),
	);
	await page.getByRole("tab", { name: "PathPlanner" }).click();
	const planner = page.locator('iframe[data-pane="pathplanner"]');
	await expect(planner).toBeVisible();
	const plannerBody = planner.contentFrame().locator("body");
	await expect(plannerBody).toHaveAttribute("data-fake-pathplanner-loads", "1");
	const separator = page.getByRole("separator", {
		name: "Resize editor and right pane",
	});
	const hideEditor = page.getByRole("button", {
		name: "Hide editor",
		exact: true,
	});
	const editorControl = hideEditor.locator("..");
	await page.getByRole("tab", { name: "PathPlanner" }).focus();
	await expect(editorControl).toHaveCSS("opacity", "0");
	await separator.hover();
	await expect(editorControl).toHaveCSS("opacity", "1");
	await separator.focus();
	await separator.press("ArrowLeft");
	await separator.press("ArrowLeft");
	const width = (await editor.boundingBox())!.width;
	await page.getByRole("button", { name: "Hide editor", exact: true }).click();
	await expect(editor).not.toBeVisible();
	await expect(planner).toBeVisible();
	// Restore tab overlays the edge: no full-height rail steals pane width.
	const restore = page.locator("[data-pane=editor-restore]");
	expect((await restore.boundingBox())!.height).toBeLessThan(50);
	expect(
		Math.abs(
			(await planner.boundingBox())!.width -
				(await page.locator("#ide-workbench").boundingBox())!.width,
		),
	).toBeLessThan(3);
	await page.getByRole("button", { name: "Show editor", exact: true }).click();
	await expect(editor).toBeVisible();
	await page.mouse.move(0, 0);
	await expect(hideEditor).not.toBeFocused();
	await expect(editorControl).toHaveCSS("opacity", "0");
	// Keyboard activation keeps focus on the corresponding control.
	await hideEditor.focus();
	await hideEditor.press("Enter");
	const showEditor = page.getByRole("button", {
		name: "Show editor",
		exact: true,
	});
	await expect(showEditor).toBeFocused();
	await showEditor.press("Enter");
	await expect(hideEditor).toBeFocused();
	await expect(editorControl).toHaveCSS("opacity", "1");
	expect(Math.abs((await editor.boundingBox())!.width - width)).toBeLessThan(3);
	await expect(editorBody).toHaveAttribute("data-layout-sentinel", "alive");
	await page.getByRole("button", { name: "Hide right pane" }).click();
	await expect(planner).not.toBeVisible();
	// Selecting the already-active tab must reveal the collapsed pane too.
	await page.getByRole("tab", { name: "PathPlanner" }).click();
	await expect(planner).toBeVisible();
	await expect(plannerBody).toHaveAttribute("data-fake-pathplanner-loads", "1");
	await page.getByRole("button", { name: "Hide Driver Station" }).click();
	await expect(page.locator("#ide-console")).not.toBeVisible();
	const compact = page.locator('[data-pane="console-restore"]');
	await expect(compact.getByRole("status")).toBeVisible();
	const disable = page.waitForRequest(
		(req) =>
			req.method() === "PATCH" && req.url().includes("/sim/driver-station"),
	);
	await compact.getByRole("button", { name: "Disable", exact: true }).click();
	expect((await disable).postDataJSON()).toMatchObject({ enabled: false });
	await page.reload();
	await expect(compact).toBeVisible();
	await page.getByRole("button", { name: "User menu", exact: true }).click();
	await page.getByRole("menuitem", { name: "Layout", exact: true }).click();
	await page.getByRole("menuitem", { name: "Reset layout" }).click();
	await expect(page.locator("#ide-console")).toBeVisible();
	await expect(editor).toBeVisible();
	await expect(planner).toBeVisible();
	expect(
		Math.abs(
			(await editor.boundingBox())!.width -
				(await planner.boundingBox())!.width,
		),
	).toBeLessThan(3);
});

test("narrow screens switch upper panes and recover the desktop split", async ({
	page,
	app,
	runtime,
	fakeVscode,
	fakeHalsim,
}) => {
	const { user } = await loginAs(page, app, { name: "Narrow panes" });
	const workspace = app.storage.findWorkspaceBySlug(user.slug as never)!;
	await seedWorkspaceProject(workspace.project_path);
	seedRuntimeRunning({
		runtime,
		workspaceId: workspace.id,
		fakeVscode,
		fakeHalsim,
	});
	await page.goto(`/u/${user.slug}/`);
	const editor = page.locator('[data-pane="editor"] iframe');
	await expect(editor).toBeVisible();
	const width = (await editor.boundingBox())!.width;
	await page.setViewportSize({ width: 800, height: 720 });
	await expect(editor).toBeVisible();
	await expect(page.locator("#ide-scope")).not.toBeVisible();
	await page.getByRole("tab", { name: "PathPlanner" }).click();
	await expect(editor).not.toBeVisible();
	await expect(page.locator("#ide-scope")).toBeVisible();
	await page.reload();
	await expect(page.locator("#ide-scope")).toBeVisible();
	await expect(editor).not.toBeVisible();
	await page.getByRole("button", { name: "Show editor" }).click();
	await expect(editor).toBeVisible();
	await expect(page.locator("#ide-scope")).not.toBeVisible();
	await page.setViewportSize({ width: 1280, height: 720 });
	await expect(page.locator("#ide-scope")).toBeVisible();
	expect(Math.abs((await editor.boundingBox())!.width - width)).toBeLessThan(3);
});
