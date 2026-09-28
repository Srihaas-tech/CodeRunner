import { fireEvent, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { expect, test, vi } from "vitest";
import { DriverStation } from "./DriverStation";

vi.mock("./ConsolePanel", () => ({ ConsolePanel: () => null }));

test("collapsing a focused Driver Station releases keyboard input and requires refocusing", () => {
	const release = vi.fn();
	const change = vi.fn();
	const props: ComponentProps<typeof DriverStation> = {
		simulationStatus: null,
		runStatus: "idle",
		runConnection: "disconnected",
		sessionReady: true,
		consoleLines: [],
		autoStatus: null,
		gamepad: {
			inputMode: "keyboard",
			available: [],
			selectedIndex: null,
			frame: null,
			keyboardFrame: null,
			keyboardPressedCodes: new Set(),
			channelConnection: "disconnected",
			channelHalsimDisconnected: false,
			onSelectControllerMode: vi.fn(),
			onSelectKeyboardMode: vi.fn(),
			onKeyboardCodesChange: change,
			onKeyboardRelease: release,
			onSelect: vi.fn(),
			onRelease: vi.fn(),
		},
		onStartRun: vi.fn(),
		onStopRun: vi.fn(),
		onRestartRun: vi.fn(),
		onSetDriverStation: vi.fn(),
		onSelectAuto: vi.fn(),
	};
	const { container, rerender } = render(<DriverStation {...props} />);
	const section = container.querySelector("section")!;
	fireEvent.focus(section);
	fireEvent.keyDown(section, { code: "KeyW" });
	expect(change).toHaveBeenCalledOnce();
	rerender(<DriverStation {...props} visible={false} />);
	expect(release).toHaveBeenCalledOnce();
	rerender(<DriverStation {...props} visible />);
	fireEvent.keyDown(section, { code: "KeyW" });
	expect(change).toHaveBeenCalledOnce();
	fireEvent.focus(section);
	fireEvent.keyDown(section, { code: "KeyW" });
	expect(change).toHaveBeenCalledTimes(2);
});
