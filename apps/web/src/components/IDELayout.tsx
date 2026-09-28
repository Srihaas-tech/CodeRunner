import { ChevronFirst, ChevronLast, Play } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import type { GroupImperativeHandle } from "react-resizable-panels";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@/components/ui/resizable";
import type { PaneVisibility } from "@/hooks/usePaneVisibility";

// Persist expanded sizes only, using the existing session keys.
function useSplit(
	id: string,
	first: string,
	second: string,
	fallback: number,
	firstVisible: boolean,
	secondVisible: boolean,
	resetVersion: number,
	onCollapse?: (first: boolean) => void,
) {
	const groupRef = useRef<GroupImperativeHandle>(null);
	const key = `react-resizable-panels:${id}`;
	function read() {
		try {
			const stored = JSON.parse(sessionStorage.getItem(key) ?? "null");
			// Console Preview previously used different panel IDs.
			const a = stored?.[first] ?? stored?.["ide-console-editor"];
			const b = stored?.[second] ?? stored?.["ide-console-preview"];
			if (
				Number.isFinite(a) &&
				Number.isFinite(b) &&
				a > 0 &&
				b > 0 &&
				Math.abs(a + b - 100) < 0.1
			)
				return a as number;
		} catch {
			/* Storage is optional. */
		}
		return fallback;
	}
	const expanded = useRef(read());
	const previous = useRef({ key, resetVersion });
	if (
		previous.current.key !== key ||
		previous.current.resetVersion !== resetVersion
	) {
		expanded.current = read();
		previous.current = { key, resetVersion };
	}
	const size = !firstVisible ? 0 : !secondVisible ? 100 : expanded.current;
	useLayoutEffect(() => {
		// A reset must apply even if a drag happened since the last render.
		void resetVersion;
		void key;
		groupRef.current?.setLayout({ [first]: size, [second]: 100 - size });
	}, [first, second, size, resetVersion, key]);
	return {
		groupRef,
		defaultLayout: { [first]: size, [second]: 100 - size },
		onLayoutChanged: (layout: Record<string, number>) => {
			const a = layout[first];
			const b = layout[second];
			if (firstVisible && secondVisible && (a === 0 || b === 0)) {
				onCollapse?.(a === 0);
				return;
			}
			if (
				!firstVisible ||
				!secondVisible ||
				a === undefined ||
				b === undefined ||
				a <= 0 ||
				b <= 0
			)
				return;
			expanded.current = a;
			try {
				sessionStorage.setItem(key, JSON.stringify(layout));
			} catch {
				/* Storage is optional. */
			}
		},
	};
}

function PaneButton({
	label,
	onClick,
	children,
	className = "",
}: {
	label: string;
	onClick: () => void;
	children: ReactNode;
	className?: string;
}) {
	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			onClick={(event) => {
				const button = event.currentTarget;
				onClick();
				// Pointer activation should not focus the opposite pane control.
				// Keyboard and assistive activation still need a focus destination.
				if (event.detail !== 0) return;
				requestAnimationFrame(() => {
					if (button.isConnected && button.getClientRects().length) return;
					const nextLabel =
						label === "Show Preview"
							? "Hide right pane"
							: label.startsWith("Hide ")
								? label.replace("Hide ", "Show ")
								: label.replace("Show ", "Hide ");
					const target =
						document.querySelector<HTMLButtonElement>(
							`button[aria-label="${nextLabel}"]`,
						) ??
						document.querySelector<HTMLButtonElement>(
							'button[aria-label="User menu"]',
						);
					target?.focus();
				});
			}}
			className={`flex size-5 shrink-0 items-center justify-center rounded-sm border border-border bg-card text-muted-foreground shadow-sm hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring ${className}`}
		>
			{children}
		</button>
	);
}

interface IDELayoutProps {
	editor: ReactNode;
	scope: ReactNode;
	driverStation: ReactNode;
	showRightPane?: boolean;
	showDriverStation?: boolean;
	layout?: PaneVisibility;
	compactDriverStation?: ReactNode;
}

export function IDELayout({
	editor,
	scope,
	driverStation,
	showRightPane = true,
	showDriverStation = true,
	layout,
	compactDriverStation,
}: IDELayoutProps) {
	const editorVisible = layout?.editorVisible ?? true;
	const rightVisible = layout?.rightVisible ?? showRightPane;
	const bottomVisible = showDriverStation && (layout?.bottomVisible ?? true);
	const split = editorVisible && rightVisible;
	const columns = useSplit(
		showDriverStation ? "ide-columns" : "ide-console-columns",
		"ide-editor",
		"ide-scope",
		showDriverStation ? 50 : 55,
		editorVisible,
		rightVisible,
		layout?.resetVersion ?? 0,
		(first) =>
			first ? layout?.setEditorVisible(false) : layout?.setRightVisible(false),
	);
	const rows = useSplit(
		"ide-rows",
		"ide-workbench",
		"ide-console",
		75,
		true,
		bottomVisible,
		layout?.resetVersion ?? 0,
		() => layout?.setBottomVisible(false),
	);

	return (
		<div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
			<ResizablePanelGroup
				orientation="vertical"
				data-pane-group="rows"
				className="min-h-0 flex-1"
				{...rows}
			>
				<ResizablePanel id="ide-workbench" minSize="20%" className="min-h-0">
					<div className="relative flex h-full min-h-0">
						{layout && !editorVisible && (
							<div
								data-pane="editor-restore"
								className="absolute left-0 top-1/2 z-20 -translate-y-1/2"
							>
								<PaneButton
									className="h-10 w-5 rounded-l-none rounded-r-full border-l-0"
									label="Show editor"
									onClick={() => layout.setEditorVisible(true)}
								>
									<ChevronLast className="size-3.5" />
								</PaneButton>
							</div>
						)}
						<ResizablePanelGroup
							orientation="horizontal"
							data-pane-group="columns"
							className="min-h-0 min-w-0 flex-1"
							{...columns}
						>
							<ResizablePanel
								id="ide-editor"
								collapsible
								minSize="25%"
								data-pane="editor"
								className="min-h-0"
							>
								<div
									hidden={!editorVisible}
									inert={!editorVisible}
									className="h-full min-h-0 min-w-0 bg-card"
								>
									<div className="relative flex h-full min-h-0 flex-col">
										{layout && split && (
											<div
												data-pane-controls="columns"
												className="pane-collapse absolute right-1 top-1/2 z-20 -translate-y-1/2 py-3 pl-3 pr-1"
											>
												<PaneButton
													label="Hide editor"
													onClick={() => layout.setEditorVisible(false)}
												>
													<ChevronFirst className="size-3.5" />
												</PaneButton>
											</div>
										)}
										<div className="min-h-0 flex-1">{editor}</div>
									</div>
								</div>
							</ResizablePanel>
							<ResizableHandle
								disabled={!split}
								data-pane="scope-handle"
								aria-label="Resize editor and right pane"
								className={split ? "z-30" : "hidden"}
								withHandle
							/>
							<ResizablePanel
								id="ide-scope"
								collapsible
								minSize="25%"
								data-pane="scope"
								className="min-h-0"
							>
								<div
									hidden={!rightVisible}
									inert={!rightVisible}
									className="h-full min-h-0"
								>
									<div className="relative flex h-full min-h-0 flex-col">
										{layout && split && (
											<div
												data-pane-controls="columns"
												className="pane-collapse absolute left-1 top-1/2 z-20 -translate-y-1/2 py-3 pl-1 pr-3"
											>
												<PaneButton
													label="Hide right pane"
													onClick={() => layout.setRightVisible(false)}
												>
													<ChevronLast className="size-3.5" />
												</PaneButton>
											</div>
										)}
										<div className="min-h-0 flex-1">{scope}</div>
									</div>
								</div>
							</ResizablePanel>
						</ResizablePanelGroup>
						{layout && !rightVisible && (
							<div
								data-pane="scope-restore"
								className="absolute right-0 top-1/2 z-20 -translate-y-1/2"
							>
								<PaneButton
									className="h-10 w-5 rounded-l-full rounded-r-none border-r-0"
									label={showDriverStation ? "Show right pane" : "Show Preview"}
									onClick={() => layout.setRightVisible(true)}
								>
									<ChevronFirst className="size-3.5" />
								</PaneButton>
							</div>
						)}
					</div>
				</ResizablePanel>
				<ResizableHandle
					disabled={!bottomVisible}
					aria-label="Resize Driver Station"
					className={bottomVisible ? "z-30" : "hidden"}
					withHandle
				/>
				<ResizablePanel
					id="ide-console"
					collapsible
					minSize="5%"
					data-pane="console"
					className="min-h-0 overflow-hidden"
				>
					<div
						hidden={!bottomVisible}
						inert={!bottomVisible}
						className="h-full"
					>
						<div className="relative flex h-full min-h-0 flex-col">
							{showDriverStation && layout && (
								<div
									data-pane-controls="rows"
									className="pane-collapse absolute left-1/2 top-1 z-20 -translate-x-1/2 px-3 pb-3 pt-1"
								>
									<PaneButton
										label="Hide Driver Station"
										onClick={() => layout.setBottomVisible(false)}
									>
										<ChevronLast className="size-3.5 rotate-90" />
									</PaneButton>
								</div>
							)}
							<div className="min-h-0 flex-1">
								{showDriverStation && driverStation}
							</div>
						</div>
					</div>
				</ResizablePanel>
			</ResizablePanelGroup>
			{showDriverStation && !bottomVisible && layout && (
				<div
					data-pane="console-restore"
					className="relative flex h-9 shrink-0 items-center justify-end gap-3 border-t border-border bg-card px-2"
				>
					<PaneButton
						label="Show Driver Station"
						onClick={() => layout.setBottomVisible(true)}
						className="absolute bottom-0 left-1/2 h-5 w-10 -translate-x-1/2 rounded-b-none rounded-t-full border-b-0"
					>
						<ChevronFirst className="size-3.5 rotate-90" />
					</PaneButton>
					{compactDriverStation}
				</div>
			)}
			{!showDriverStation && (
				<div
					data-pane="console-hint"
					className="flex shrink-0 items-center gap-2 border-t border-border bg-card px-4 py-2 text-[12px] text-muted-foreground"
				>
					<Play className="size-3.5 text-primary" />
					Run this lesson from the editor's Run button (▷ top-right of the
					file).
				</div>
			)}
		</div>
	);
}
