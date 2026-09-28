import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	findDefaultDocument,
	previewFileUrl,
	usePreviewDocuments,
} from "./usePreviewDocuments";

function listResponse(
	documents: Array<{ path: string; kind: "markdown" | "html" }>,
	overrides: Partial<{ token: string; truncated: boolean }> = {},
) {
	return {
		ok: true,
		documents,
		truncated: overrides.truncated ?? false,
		token: overrides.token ?? "p1.9999999999.sig",
		tokenExpiresIn: 900,
	};
}

function okFetch(body: unknown) {
	return vi.fn().mockResolvedValue({
		ok: true,
		status: 200,
		json: () => Promise.resolve(body),
	});
}

describe("usePreviewDocuments", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	test("does not fetch until Preview is activated", () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		renderHook(() => usePreviewDocuments("alice", false, 0));

		expect(fetchMock).not.toHaveBeenCalled();
	});

	test("does not fetch without a workspace slug", () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		renderHook(() => usePreviewDocuments(null, true, 0));

		expect(fetchMock).not.toHaveBeenCalled();
	});

	test("loads documents and derives the token-scoped file base", async () => {
		vi.stubGlobal(
			"fetch",
			okFetch(
				listResponse([{ path: "README.md", kind: "markdown" }], {
					token: "p1.123.abc",
				}),
			),
		);

		const { result } = renderHook(() => usePreviewDocuments("alice", true, 0));

		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.documents).toHaveLength(1);
		expect(result.current.loaded).toBe(true);
		expect(result.current.error).toBeNull();
		expect(result.current.filesBase).toBe(
			"/u/alice/api/preview/files/p1.123.abc",
		);
	});

	test("refresh refetches the list and mints a new token", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: () =>
					Promise.resolve(
						listResponse([{ path: "README.md", kind: "markdown" }], {
							token: "p1.1.old",
						}),
					),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: () =>
					Promise.resolve(
						listResponse(
							[
								{ path: "README.md", kind: "markdown" },
								{ path: "build/reports/index.html", kind: "html" },
							],
							{ token: "p1.2.new" },
						),
					),
			});
		vi.stubGlobal("fetch", fetchMock);

		const { result } = renderHook(() => usePreviewDocuments("alice", true, 0));
		await waitFor(() => expect(result.current.loaded).toBe(true));
		expect(result.current.documents).toHaveLength(1);

		act(() => result.current.refresh());

		await waitFor(() => expect(result.current.documents).toHaveLength(2));
		// A newly generated report becomes selectable immediately after Refresh.
		expect(result.current.documents[1]?.path).toBe("build/reports/index.html");
		expect(result.current.filesBase).toBe(
			"/u/alice/api/preview/files/p1.2.new",
		);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	test("a failed refresh reports the error instead of presenting the old list as fresh", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: () =>
					Promise.resolve(
						listResponse([{ path: "README.md", kind: "markdown" }]),
					),
			})
			.mockResolvedValueOnce({ ok: false, status: 500 });
		vi.stubGlobal("fetch", fetchMock);

		const { result } = renderHook(() => usePreviewDocuments("alice", true, 0));
		await waitFor(() => expect(result.current.loaded).toBe(true));

		act(() => result.current.refresh());

		await waitFor(() => expect(result.current.error).not.toBeNull());
		expect(result.current.error).toContain("500");
		expect(result.current.documents).toEqual([]);
		expect(result.current.filesBase).toBeNull();
		expect(result.current.loaded).toBe(false);
	});

	test("surfaces a network failure", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("network down")),
		);

		const { result } = renderHook(() => usePreviewDocuments("alice", true, 0));

		await waitFor(() => expect(result.current.error).toBe("network down"));
		expect(result.current.loaded).toBe(false);
	});

	test("a superseded response cannot overwrite a newer one", async () => {
		let resolveFirst: ((value: unknown) => void) | null = null;
		const fetchMock = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveFirst = resolve;
					}),
			)
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: () =>
					Promise.resolve(
						listResponse([{ path: "second.md", kind: "markdown" }], {
							token: "p1.2.second",
						}),
					),
			});
		vi.stubGlobal("fetch", fetchMock);

		const { result } = renderHook(() => usePreviewDocuments("alice", true, 0));

		// Start a second load while the first is still in flight, then let the
		// stale one land last.
		act(() => result.current.refresh());
		await waitFor(() => expect(result.current.documents).toHaveLength(1));
		expect(result.current.documents[0]?.path).toBe("second.md");

		await act(async () => {
			resolveFirst?.({
				ok: true,
				status: 200,
				json: () =>
					Promise.resolve(
						listResponse([{ path: "first.md", kind: "markdown" }], {
							token: "p1.1.first",
						}),
					),
			});
		});

		expect(result.current.documents[0]?.path).toBe("second.md");
		expect(result.current.filesBase).toBe(
			"/u/alice/api/preview/files/p1.2.second",
		);
	});

	test("a project swap clears the old list and reloads", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: () =>
					Promise.resolve(
						listResponse([{ path: "old.md", kind: "markdown" }], {
							token: "p1.1.old",
						}),
					),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: () =>
					Promise.resolve(
						listResponse([{ path: "new.md", kind: "markdown" }], {
							token: "p1.2.new",
						}),
					),
			});
		vi.stubGlobal("fetch", fetchMock);

		const { result, rerender } = renderHook(
			({ nonce }: { nonce: number }) =>
				usePreviewDocuments("alice", true, nonce),
			{ initialProps: { nonce: 0 } },
		);
		await waitFor(() => expect(result.current.documents).toHaveLength(1));
		expect(result.current.documents[0]?.path).toBe("old.md");

		rerender({ nonce: 1 });

		await waitFor(() =>
			expect(result.current.documents[0]?.path).toBe("new.md"),
		);
		expect(result.current.filesBase).toBe(
			"/u/alice/api/preview/files/p1.2.new",
		);
	});

	test("carries the truncation flag through", async () => {
		vi.stubGlobal(
			"fetch",
			okFetch(
				listResponse([{ path: "README.md", kind: "markdown" }], {
					truncated: true,
				}),
			),
		);

		const { result } = renderHook(() => usePreviewDocuments("alice", true, 0));

		await waitFor(() => expect(result.current.loaded).toBe(true));
		expect(result.current.truncated).toBe(true);
	});
});

describe("previewFileUrl", () => {
	test("encodes each path segment without encoding the separators", () => {
		expect(previewFileUrl("/base", "docs/my notes.md")).toBe(
			"/base/docs/my%20notes.md",
		);
		expect(previewFileUrl("/base", "docs/100% done.md")).toBe(
			"/base/docs/100%25%20done.md",
		);
		expect(previewFileUrl("/base", "docs/weird #1.md")).toBe(
			"/base/docs/weird%20%231.md",
		);
	});
});

describe("findDefaultDocument", () => {
	test("selects the root README, case-insensitively", () => {
		expect(
			findDefaultDocument([
				{ path: "docs/guide.md", kind: "markdown" },
				{ path: "ReadMe.md", kind: "markdown" },
			])?.path,
		).toBe("ReadMe.md");
	});

	test("ignores a README that is not at the project root", () => {
		expect(
			findDefaultDocument([{ path: "docs/README.md", kind: "markdown" }]),
		).toBeNull();
	});

	test("opens nothing when there is no README", () => {
		// Deliberately does not fall back to a licence or an arbitrary report.
		expect(
			findDefaultDocument([
				{ path: "LICENSE.md", kind: "markdown" },
				{ path: "build/reports/index.html", kind: "html" },
			]),
		).toBeNull();
	});
});
