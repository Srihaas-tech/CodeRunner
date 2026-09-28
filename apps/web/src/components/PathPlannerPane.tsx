import { Loader2 } from "lucide-react";
import { forwardRef, useCallback, useState } from "react";

interface PathPlannerPaneProps {
	workspaceSlug: string | null;
}

/**
 * Iframe host for the PathPlanner web build served at /pathplanner/. The
 * app inside reads `?ws=<slug>` to address its deploy-files API base; the
 * session cookie (same origin) authenticates those calls.
 */
export const PathPlannerPane = forwardRef<
	HTMLIFrameElement,
	PathPlannerPaneProps
>(function PathPlannerPane({ workspaceSlug }, ref) {
	const [iframeLoaded, setIframeLoaded] = useState(false);
	const handleLoad = useCallback(() => setIframeLoaded(true), []);

	return (
		<aside className="relative flex h-full min-h-0 min-w-0 flex-col border-l border-border bg-card">
			{workspaceSlug !== null && (
				<iframe
					ref={ref}
					title="PathPlanner"
					data-pane="pathplanner"
					src={`/pathplanner/?ws=${encodeURIComponent(workspaceSlug)}`}
					className="min-h-0 w-full flex-1 border-0 bg-white"
					onLoad={handleLoad}
				/>
			)}
			{workspaceSlug !== null && !iframeLoaded && (
				<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card">
					<Loader2 className="size-8 animate-spin text-muted-foreground" />
					<span className="font-mono text-sm text-muted-foreground">
						Loading PathPlanner…
					</span>
				</div>
			)}
			{workspaceSlug === null && (
				<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card">
					<span className="font-mono text-sm text-muted-foreground">
						PathPlanner is not available for this module.
					</span>
				</div>
			)}
		</aside>
	);
});
