import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { usePaneVisibility } from "./usePaneVisibility";

afterEach(() => sessionStorage.clear());

describe("pane visibility", () => {
	test("hiding the last upper pane reveals the other and restores the choice on reload", () => {
		const { result, unmount } = renderHook(() => usePaneVisibility(false));
		act(() => result.current.setEditorVisible(false));
		expect(result.current.editorVisible).toBe(false);
		expect(result.current.rightVisible).toBe(true);
		act(() => result.current.setRightVisible(false));
		expect(result.current.editorVisible).toBe(true);
		expect(result.current.rightVisible).toBe(false);
		act(() => result.current.setBottomVisible(false));
		unmount();
		const restored = renderHook(() => usePaneVisibility(false));
		expect(restored.result.current.rightVisible).toBe(false);
		expect(restored.result.current.bottomVisible).toBe(false);
	});

	test("project kinds keep separate visibility preferences and reset clears sizes", () => {
		const { result, rerender } = renderHook(
			({ consoleLesson }) => usePaneVisibility(consoleLesson),
			{ initialProps: { consoleLesson: false } },
		);
		act(() => result.current.setEditorVisible(false));
		rerender({ consoleLesson: true });
		expect(result.current.editorVisible).toBe(true);
		expect(result.current.rightVisible).toBe(false);
		act(() => result.current.setRightVisible(true));
		rerender({ consoleLesson: false });
		expect(result.current.editorVisible).toBe(false);
		sessionStorage.setItem("react-resizable-panels:ide-columns", "{}");
		act(() => result.current.reset());
		expect(result.current.editorVisible).toBe(true);
		expect(result.current.rightVisible).toBe(true);
		expect(
			sessionStorage.getItem("react-resizable-panels:ide-columns"),
		).toBeNull();
		rerender({ consoleLesson: true });
		expect(result.current.rightVisible).toBe(true);
	});

	test("invalid saved visibility falls back to a usable layout", () => {
		sessionStorage.setItem(
			"coderunner:pane-visibility:robot",
			'{"upper":"none","bottom":false}',
		);
		const { result } = renderHook(() => usePaneVisibility(false));
		expect(result.current.editorVisible).toBe(true);
		expect(result.current.rightVisible).toBe(true);
		expect(result.current.bottomVisible).toBe(true);
	});
});
