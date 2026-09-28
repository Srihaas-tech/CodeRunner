import { useCallback, useEffect, useRef, useState } from "react";
import type { PreviewDocument } from "@/lib/contracts";
import { previewDocumentsResponseSchema } from "@/lib/contracts";

export type PreviewDocumentsState = {
	documents: PreviewDocument[];
	/** Path prefix for `<iframe src>`; null until a list has loaded. */
	filesBase: string | null;
	truncated: boolean;
	loading: boolean;
	/** Non-null when the most recent load failed; the old list is then dropped. */
	error: string | null;
	/** Whether a list has ever loaded, so callers can tell "empty" from "not yet". */
	loaded: boolean;
	/** Increments after each successful load, even if the token is unchanged. */
	revision: number;
	/** Reload the list from disk. Also re-mints the resource token. */
	refresh: () => void;
};

/**
 * Loads `GET /api/preview/documents`.
 *
 * Fetches only on explicit demand — first activation, project swap, or the
 * Refresh button. There is deliberately no watcher, poll, or post-run trigger:
 * the student decides when the list is re-read.
 */
export function usePreviewDocuments(
	workspaceSlug: string | null,
	/** Activation gate: nothing is fetched until Preview has been opened once. */
	active: boolean,
	/** Bumped on project replacement to discard the old project's list. */
	reloadNonce: number,
): PreviewDocumentsState {
	const [documents, setDocuments] = useState<PreviewDocument[]>([]);
	const [filesBase, setFilesBase] = useState<string | null>(null);
	const [truncated, setTruncated] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [loaded, setLoaded] = useState(false);
	const [revision, setRevision] = useState(0);
	const [refreshNonce, setRefreshNonce] = useState(0);

	// Guards against a slow response from a previous project or a superseded
	// Refresh landing after a newer one and overwriting it.
	const generationRef = useRef(0);

	const refresh = useCallback(() => setRefreshNonce((n) => n + 1), []);

	// A project swap invalidates everything the old project's token addressed.
	// Clear synchronously on nonce change rather than waiting for the refetch,
	// so no stale document can be shown against the new project.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `reloadNonce` is the invalidation trigger.
	useEffect(() => {
		generationRef.current += 1;
		setDocuments([]);
		setFilesBase(null);
		setTruncated(false);
		setError(null);
		setLoaded(false);
	}, [reloadNonce]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `refreshNonce` is a manual refetch trigger.
	useEffect(() => {
		if (!workspaceSlug || !active) return;

		generationRef.current += 1;
		const generation = generationRef.current;
		const controller = new AbortController();
		setLoading(true);

		void (async () => {
			try {
				const response = await fetch(
					`/u/${workspaceSlug}/api/preview/documents`,
					{ credentials: "same-origin", signal: controller.signal },
				);
				if (!response.ok) {
					throw new Error(`Document list failed (HTTP ${response.status}).`);
				}
				const parsed = previewDocumentsResponseSchema.parse(
					await response.json(),
				);
				if (generation !== generationRef.current) return;
				setDocuments(parsed.documents);
				setFilesBase(`/u/${workspaceSlug}/api/preview/files/${parsed.token}`);
				setTruncated(parsed.truncated);
				setError(null);
				setLoaded(true);
				setRevision((current) => current + 1);
			} catch (err) {
				if (controller.signal.aborted) return;
				if (generation !== generationRef.current) return;
				// Never leave a stale list on screen looking freshly loaded.
				setDocuments([]);
				setFilesBase(null);
				setTruncated(false);
				setLoaded(false);
				setError(
					err instanceof Error
						? err.message
						: "Unable to load the document list.",
				);
			} finally {
				if (generation === generationRef.current) setLoading(false);
			}
		})();

		return () => controller.abort();
	}, [workspaceSlug, active, reloadNonce, refreshNonce]);

	return {
		documents,
		filesBase,
		truncated,
		loading,
		error,
		loaded,
		revision,
		refresh,
	};
}

/** Build the iframe URL for one document, encoding each path segment. */
export function previewFileUrl(filesBase: string, path: string): string {
	return `${filesBase}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * The root `README.md`, matched case-insensitively. Anything else — a licence,
 * an arbitrary generated report — is left for the student to choose, so Preview
 * never opens something surprising on their behalf.
 */
export function findDefaultDocument(
	documents: PreviewDocument[],
): PreviewDocument | null {
	return (
		documents.find(
			(doc) =>
				!doc.path.includes("/") && doc.path.toLowerCase() === "readme.md",
		) ?? null
	);
}
