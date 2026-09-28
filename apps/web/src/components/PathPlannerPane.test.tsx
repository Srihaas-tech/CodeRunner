import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { PathPlannerPane } from "./PathPlannerPane";

describe("PathPlannerPane", () => {
	test("renders the iframe pointed at the workspace's PathPlanner URL", () => {
		render(<PathPlannerPane workspaceSlug="alice" />);
		const frame = screen.getByTitle<HTMLIFrameElement>("PathPlanner");
		expect(frame).toBeInTheDocument();
		expect(frame.getAttribute("src")).toBe("/pathplanner/?ws=alice");
	});

	test("shows the loading overlay until the iframe loads", () => {
		render(<PathPlannerPane workspaceSlug="alice" />);
		expect(screen.getByText(/Loading PathPlanner/)).toBeInTheDocument();

		fireEvent.load(screen.getByTitle("PathPlanner"));
		expect(screen.queryByText(/Loading PathPlanner/)).toBeNull();
	});

	// A project swap (lesson load or team import) rewrites the deploy files on
	// disk. WorkspacePage remounts this pane by bumping its `key`, which must
	// give the iframe a fresh document so PathPlanner re-fetches the snapshot
	// instead of writing its stale in-memory tree back over the new project.
	test("remounting drops the loaded iframe so the snapshot is re-fetched", () => {
		const { rerender } = render(
			<PathPlannerPane key={0} workspaceSlug="alice" />,
		);
		const first = screen.getByTitle<HTMLIFrameElement>("PathPlanner");
		fireEvent.load(first);
		expect(screen.queryByText(/Loading PathPlanner/)).toBeNull();

		rerender(<PathPlannerPane key={1} workspaceSlug="alice" />);

		const second = screen.getByTitle<HTMLIFrameElement>("PathPlanner");
		expect(second).not.toBe(first);
		expect(screen.getByText(/Loading PathPlanner/)).toBeInTheDocument();
	});

	test("renders a calm empty state without a slug, not a stuck spinner", () => {
		render(<PathPlannerPane workspaceSlug={null} />);
		expect(screen.queryByTitle("PathPlanner")).toBeNull();
		expect(screen.queryByText(/Loading PathPlanner/)).toBeNull();
		expect(
			screen.getByText(/PathPlanner is not available for this module/),
		).toBeInTheDocument();
	});
});
