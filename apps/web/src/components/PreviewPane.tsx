import { Combobox } from "@base-ui/react/combobox";
import { ChevronsUpDown, FileText, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	findDefaultDocument,
	previewFileUrl,
	usePreviewDocuments,
} from "@/hooks/usePreviewDocuments";
import type { PreviewDocument } from "@/lib/contracts";
import { cn } from "@/lib/utils";

interface PreviewPaneProps {
	workspaceSlug: string | null;
	/** True once Preview has been opened; gates the first document-list fetch. */
	active: boolean;
	/** Bumped on project replacement, to drop the old project's selection. */
	reloadNonce: number;
}

interface PreviewFrame {
	id: string;
	scope: string;
	src: string;
}

function splitPath(path: string): { name: string; directory: string } {
	const cut = path.lastIndexOf("/");
	return cut === -1
		? { name: path, directory: "" }
		: { name: path.slice(cut + 1), directory: path.slice(0, cut) };
}

/**
 * Matches on the whole project-relative path, so a student can narrow by folder
 * ("reports index") as well as by filename. Every whitespace-separated term has
 * to appear somewhere in the path.
 */
function matchesQuery(document: PreviewDocument, query: string): boolean {
	const haystack = document.path.toLowerCase();
	return query
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.every((term) => haystack.includes(term));
}

/**
 * Reads project Markdown and generated HTML reports beside the editor.
 *
 * The document is rendered by the control plane and framed with
 * `sandbox="allow-scripts"` and no `allow-same-origin`, so a report's own
 * scripts run but cannot touch this shell. That also means the frame's requests
 * carry no session cookie — authorisation rides in the `filesBase` path prefix
 * instead (see `preview-token.ts` on the server).
 */
export function PreviewPane({
	workspaceSlug,
	active,
	reloadNonce,
}: PreviewPaneProps) {
	const {
		documents,
		filesBase,
		truncated,
		loading,
		error,
		loaded,
		revision,
		refresh,
	} = usePreviewDocuments(workspaceSlug, active, reloadNonce);

	const [selected, setSelected] = useState<PreviewDocument | null>(null);
	const [query, setQuery] = useState("");
	const [displayedFrame, setDisplayedFrame] = useState<PreviewFrame | null>(
		null,
	);
	const triggerRef = useRef<HTMLButtonElement>(null);

	// Project swap: forget the old project's document entirely.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `reloadNonce` is the invalidation trigger.
	useEffect(() => {
		setSelected(null);
		setQuery("");
	}, [reloadNonce]);

	// On the first list of a project, open the root README if there is one.
	// Otherwise leave nothing selected: opening an arbitrary licence or report
	// on the student's behalf would be worse than asking them to choose.
	useEffect(() => {
		if (!loaded || selected !== null) return;
		const preferred = findDefaultDocument(documents);
		if (preferred) setSelected(preferred);
	}, [loaded, documents, selected]);

	// If a Refresh shows the selected file is gone, keep the name so the pane can
	// say which document disappeared, but stop trying to render it.
	const selectionMissing =
		loaded &&
		selected !== null &&
		!documents.some((doc) => doc.path === selected.path);

	const filtered = useMemo(
		() =>
			query.trim() === ""
				? documents
				: documents.filter((doc) => matchesQuery(doc, query)),
		[documents, query],
	);

	const onRefresh = useCallback(() => {
		refresh();
	}, [refresh]);

	const onValueChange = useCallback((value: PreviewDocument | null) => {
		if (!value) return;
		setSelected(value);
	}, []);

	const frameSrc =
		filesBase && selected && !selectionMissing
			? previewFileUrl(filesBase, selected.path)
			: null;
	const frameScope = `${workspaceSlug ?? ""}:${reloadNonce}`;
	const desiredFrame = useMemo<PreviewFrame | null>(
		() =>
			frameSrc
				? {
						id: `${frameSrc}#${revision}`,
						scope: frameScope,
						src: frameSrc,
					}
				: null,
		[frameScope, frameSrc, revision],
	);

	// Keep the current document visible while its replacement loads. Browsers
	// briefly paint a new iframe white, which is especially jarring over a dark
	// Markdown document. A project replacement still swaps immediately so old
	// project content never lingers in the new project.
	useEffect(() => {
		if (!desiredFrame) {
			setDisplayedFrame(null);
			return;
		}
		setDisplayedFrame((current) =>
			current?.scope === desiredFrame.scope ? current : desiredFrame,
		);
	}, [desiredFrame]);

	const visibleFrame = desiredFrame
		? displayedFrame?.scope === desiredFrame.scope
			? displayedFrame
			: desiredFrame
		: null;
	const loadingFrame =
		desiredFrame && desiredFrame.id !== visibleFrame?.id ? desiredFrame : null;
	const frames = visibleFrame
		? loadingFrame
			? [visibleFrame, loadingFrame]
			: [visibleFrame]
		: [];

	return (
		<aside
			className="flex h-full min-h-0 min-w-0 flex-col border-l border-border bg-card"
			data-pane="preview"
		>
			{/* Reserved strip: the toolbar never overlaps the document, only its
			    open menu does. */}
			<div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2">
				<Combobox.Root
					items={filtered}
					value={selected}
					onValueChange={onValueChange}
					onInputValueChange={setQuery}
					itemToStringLabel={(doc: PreviewDocument) => doc.path}
					isItemEqualToValue={(a: PreviewDocument, b: PreviewDocument) =>
						a.path === b.path
					}
					filter={null}
					onOpenChange={(open) => {
						if (!open) setQuery("");
					}}
				>
					<Combobox.Trigger
						ref={triggerRef}
						disabled={!loaded || documents.length === 0}
						className={cn(
							"flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-[12.5px]",
							"hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
							"disabled:pointer-events-none disabled:opacity-50",
						)}
						data-testid="preview-picker"
					>
						<FileText className="size-3.5 shrink-0 text-muted-foreground" />
						<span className="min-w-0 flex-1 truncate text-left">
							{selected ? selected.path : "Choose a document…"}
						</span>
						<ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
					</Combobox.Trigger>

					<Combobox.Portal>
						<Combobox.Positioner
							className="isolate z-50 outline-none"
							sideOffset={4}
							align="start"
						>
							<Combobox.Popup className="max-h-80 w-(--anchor-width) min-w-72 overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none">
								<div className="border-b border-border p-1.5">
									<Combobox.Input
										placeholder="Search documents…"
										className="h-7 w-full rounded-md border border-border bg-background px-2 text-[12.5px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
									/>
								</div>
								<Combobox.Empty className="px-3 py-6 text-center text-[12.5px] text-muted-foreground">
									No documents match that search.
								</Combobox.Empty>
								<Combobox.List className="max-h-64 overflow-y-auto p-1">
									{(doc: PreviewDocument) => {
										const { name, directory } = splitPath(doc.path);
										return (
											<Combobox.Item
												key={doc.path}
												value={doc}
												className="flex cursor-default flex-col items-start gap-0 rounded-md px-2 py-1.5 text-[12.5px] outline-none select-none data-highlighted:bg-muted data-selected:bg-muted"
											>
												<span className="w-full truncate font-medium">
													{name}
												</span>
												{/* The full path disambiguates the many index.html files
												    a generated report tree contains. */}
												<span className="w-full truncate text-[11px] text-muted-foreground">
													{directory === "" ? "project root" : directory}
												</span>
											</Combobox.Item>
										);
									}}
								</Combobox.List>
								{truncated && (
									<div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
										This project has more documents than Preview lists.
									</div>
								)}
							</Combobox.Popup>
						</Combobox.Positioner>
					</Combobox.Portal>
				</Combobox.Root>

				<Button
					type="button"
					variant="outline"
					size="sm"
					className="h-7 shrink-0 gap-1.5 px-2 text-[12.5px]"
					onClick={onRefresh}
					disabled={!workspaceSlug || loading}
				>
					<RefreshCw
						className={cn("size-3.5", loading && "animate-spin")}
						aria-hidden="true"
					/>
					Refresh
				</Button>
			</div>

			<div className="relative min-h-0 flex-1">
				{visibleFrame ? (
					frames.map((previewFrame) => {
						const visible = previewFrame.id === visibleFrame.id;
						return (
							<iframe
								key={previewFrame.id}
								title="Document preview"
								data-testid={
									visible ? "preview-frame" : "preview-frame-loading"
								}
								src={previewFrame.src}
								sandbox="allow-scripts"
								aria-hidden={!visible}
								onLoad={
									visible ? undefined : () => setDisplayedFrame(previewFrame)
								}
								className={cn(
									"absolute inset-0 h-full w-full border-0 bg-white",
									!visible && "invisible pointer-events-none",
								)}
							/>
						);
					})
				) : (
					<PreviewPlaceholder
						loading={loading}
						loaded={loaded}
						error={error}
						missingPath={selectionMissing ? (selected?.path ?? null) : null}
						empty={loaded && documents.length === 0}
					/>
				)}
			</div>
		</aside>
	);
}

interface PreviewPlaceholderProps {
	loading: boolean;
	loaded: boolean;
	error: string | null;
	missingPath: string | null;
	empty: boolean;
}

function PreviewPlaceholder({
	loading,
	loaded,
	error,
	missingPath,
	empty,
}: PreviewPlaceholderProps) {
	let body: React.ReactNode;
	if (error) {
		body = (
			<>
				<p className="font-medium text-foreground">
					Could not load the document list.
				</p>
				<p>{error}</p>
				<p>Click Refresh to try again.</p>
			</>
		);
	} else if (loading && !loaded) {
		body = (
			<>
				<Loader2 className="size-6 animate-spin" aria-hidden="true" />
				<p>Looking for documents…</p>
			</>
		);
	} else if (missingPath) {
		body = (
			<>
				<p className="font-medium text-foreground">
					{missingPath} is no longer available.
				</p>
				<p>Choose another document from the list.</p>
			</>
		);
	} else if (empty) {
		body = (
			<p>
				No Markdown or HTML files found. Add a document or generate a report,
				then refresh.
			</p>
		);
	} else if (loaded) {
		body = <p>Choose a document to read it here.</p>;
	} else {
		body = <p>Preview is not available for this workspace.</p>;
	}

	return (
		<div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center text-[12.5px] text-muted-foreground">
			{body}
		</div>
	);
}
