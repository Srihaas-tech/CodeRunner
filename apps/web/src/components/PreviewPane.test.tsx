import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { PreviewPane } from "./PreviewPane";

type Doc = { path: string; kind: "markdown" | "html" };

function listBody(documents: Doc[], token = "p1.9999999999.sig") {
	return {
		ok: true,
		documents,
		truncated: false,
		token,
		tokenExpiresIn: 900,
	};
}

function stubList(...bodies: Array<ReturnType<typeof listBody>>) {
	const fetchMock = vi.fn();
	for (const body of bodies) {
		fetchMock.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () => Promise.resolve(body),
		});
	}
	// Any further calls repeat the last body.
	const last = bodies.at(-1);
	fetchMock.mockResolvedValue({
		ok: true,
		status: 200,
		json: () => Promise.resolve(last),
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

function frame(): HTMLIFrameElement | null {
	return document.querySelector<HTMLIFrameElement>(
		'[data-testid="preview-frame"]',
	);
}

const README: Doc = { path: "README.md", kind: "markdown" };
const GUIDE: Doc = { path: "docs/guide.md", kind: "markdown" };
const ROOT_INDEX: Doc = { path: "index.html", kind: "html" };
const REPORT_INDEX: Doc = {
	path: "build/reports/tests/test/index.html",
	kind: "html",
};

describe("PreviewPane", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	test("opens the root README automatically when there is one", async () => {
		stubList(listBody([README, GUIDE], "p1.1.tok"));

		render(<PreviewPane workspaceSlug="alice" active reloadNonce={0} />);

		await waitFor(() => expect(frame()).not.toBeNull());
		expect(frame()?.getAttribute("src")).toBe(
			"/u/alice/api/preview/files/p1.1.tok/README.md",
		);
		// The frame is stripped of same-origin privileges; see preview-token.ts.
		expect(frame()?.getAttribute("sandbox")).toBe("allow-scripts");
	});

	test("shows an instruction instead of opening something arbitrary when there is no README", async () => {
		stubList(
			listBody([{ path: "LICENSE.md", kind: "markdown" }, REPORT_INDEX]),
		);

		render(<PreviewPane workspaceSlug="alice" active reloadNonce={0} />);

		await waitFor(() =>
			expect(
				screen.getByText("Choose a document to read it here."),
			).toBeInTheDocument(),
		);
		expect(frame()).toBeNull();
	});

	test("reports an empty project", async () => {
		stubList(listBody([]));

		render(<PreviewPane workspaceSlug="alice" active reloadNonce={0} />);

		await waitFor(() =>
			expect(
				screen.getByText(/No Markdown or HTML files found/),
			).toBeInTheDocument(),
		);
	});

	test("reports a list failure with a recovery hint", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: false, status: 503 }),
		);

		render(<PreviewPane workspaceSlug="alice" active reloadNonce={0} />);

		await waitFor(() =>
			expect(
				screen.getByText("Could not load the document list."),
			).toBeInTheDocument(),
		);
		expect(screen.getByText(/Click Refresh to try again/)).toBeInTheDocument();
	});

	test("searches on the full path so duplicate filenames stay distinguishable", async () => {
		stubList(listBody([README, ROOT_INDEX, REPORT_INDEX]));
		const user = userEvent.setup();

		render(<PreviewPane workspaceSlug="alice" active reloadNonce={0} />);
		await waitFor(() => expect(frame()).not.toBeNull());

		await user.click(screen.getByTestId("preview-picker"));
		const search = await screen.findByPlaceholderText("Search documents…");

		// Both candidates are named index.html; only the path separates them.
		await user.type(search, "index.html");
		await waitFor(() =>
			expect(screen.getAllByText("index.html")).toHaveLength(2),
		);

		await user.clear(search);
		await user.type(search, "reports index");
		await waitFor(() =>
			expect(screen.getAllByText("index.html")).toHaveLength(1),
		);
		expect(screen.getByText("build/reports/tests/test")).toBeInTheDocument();
	});

	test("selecting a document points the frame at it", async () => {
		stubList(listBody([README, GUIDE], "p1.1.tok"));
		const user = userEvent.setup();

		render(<PreviewPane workspaceSlug="alice" active reloadNonce={0} />);
		await waitFor(() => expect(frame()).not.toBeNull());

		await user.click(screen.getByTestId("preview-picker"));
		const list = await screen.findByRole("listbox");
		await user.click(within(list).getByText("guide.md"));

		const loadingFrame = await screen.findByTestId("preview-frame-loading");
		expect(loadingFrame.getAttribute("src")).toBe(
			"/u/alice/api/preview/files/p1.1.tok/docs/guide.md",
		);
		fireEvent.load(loadingFrame);

		await waitFor(() =>
			expect(frame()?.getAttribute("src")).toBe(
				"/u/alice/api/preview/files/p1.1.tok/docs/guide.md",
			),
		);
		// The closed toolbar keeps the full selected path available.
		expect(screen.getByTestId("preview-picker")).toHaveTextContent(
			"docs/guide.md",
		);
	});

	test("Escape closes the picker and returns focus to the trigger", async () => {
		stubList(listBody([README, GUIDE]));
		const user = userEvent.setup();

		render(<PreviewPane workspaceSlug="alice" active reloadNonce={0} />);
		await waitFor(() => expect(frame()).not.toBeNull());

		const trigger = screen.getByTestId("preview-picker");
		await user.click(trigger);
		await screen.findByPlaceholderText("Search documents…");

		await user.keyboard("{Escape}");

		await waitFor(() =>
			expect(screen.queryByPlaceholderText("Search documents…")).toBeNull(),
		);
		expect(trigger).toHaveFocus();
	});

	test("Refresh keeps the current frame visible until its replacement loads", async () => {
		const fetchMock = stubList(
			listBody([README], "p1.1.old"),
			listBody([README, REPORT_INDEX], "p1.2.new"),
		);
		const user = userEvent.setup();

		render(<PreviewPane workspaceSlug="alice" active reloadNonce={0} />);
		await waitFor(() => expect(frame()).not.toBeNull());
		const firstKey = frame()?.getAttribute("src");

		await user.click(screen.getByRole("button", { name: /refresh/i }));

		// The old document covers the new iframe while it loads, avoiding the
		// browser's white loading frame over dark documents.
		expect(frame()?.getAttribute("src")).toBe(firstKey);
		const loadingFrame = await screen.findByTestId("preview-frame-loading");
		await waitFor(() =>
			expect(loadingFrame.getAttribute("src")).toBe(
				"/u/alice/api/preview/files/p1.2.new/README.md",
			),
		);
		expect(loadingFrame).toHaveClass("invisible");

		fireEvent.load(loadingFrame);

		await waitFor(() =>
			expect(frame()?.getAttribute("src")).toBe(
				"/u/alice/api/preview/files/p1.2.new/README.md",
			),
		);
		expect(firstKey).not.toBe(frame()?.getAttribute("src"));
		expect(fetchMock).toHaveBeenCalledTimes(2);

		// The newly generated report is now selectable.
		await user.click(screen.getByTestId("preview-picker"));
		const list = await screen.findByRole("listbox");
		expect(within(list).getByText("index.html")).toBeInTheDocument();
	});

	test("a selected file that disappears is reported, and the picker stays usable", async () => {
		stubList(
			listBody([README, GUIDE]),
			// README is gone after the refresh.
			listBody([GUIDE]),
		);
		const user = userEvent.setup();

		render(<PreviewPane workspaceSlug="alice" active reloadNonce={0} />);
		await waitFor(() => expect(frame()).not.toBeNull());

		await user.click(screen.getByRole("button", { name: /refresh/i }));

		await waitFor(() =>
			expect(
				screen.getByText("README.md is no longer available."),
			).toBeInTheDocument(),
		);
		expect(frame()).toBeNull();
		// The refreshed list is still selectable.
		expect(screen.getByTestId("preview-picker")).not.toBeDisabled();
	});

	test("replacing the project clears the old selection and content", async () => {
		stubList(
			listBody([README], "p1.1.old"),
			listBody([{ path: "NEWPROJECT.md", kind: "markdown" }], "p1.2.new"),
		);

		const { rerender } = render(
			<PreviewPane workspaceSlug="alice" active reloadNonce={0} />,
		);
		await waitFor(() =>
			expect(frame()?.getAttribute("src")).toContain("README.md"),
		);

		rerender(<PreviewPane workspaceSlug="alice" active reloadNonce={1} />);

		// The new project has no README, so nothing is auto-opened and the old
		// document is gone rather than lingering against the new project.
		await waitFor(() =>
			expect(
				screen.getByText("Choose a document to read it here."),
			).toBeInTheDocument(),
		);
		expect(frame()).toBeNull();
	});

	test("fetches nothing until Preview is activated", () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		render(
			<PreviewPane workspaceSlug="alice" active={false} reloadNonce={0} />,
		);

		expect(fetchMock).not.toHaveBeenCalled();
	});
});
