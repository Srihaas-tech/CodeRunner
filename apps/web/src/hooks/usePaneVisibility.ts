import { useEffect, useState } from "react";

export type UpperPanes = "both" | "editor" | "right";
interface Visibility {
	upper: UpperPanes;
	bottom: boolean;
	narrowPane: "editor" | "right";
}

function readVisibility(key: string, consoleLesson: boolean): Visibility {
	const fallback: Visibility = {
		upper: consoleLesson ? "editor" : "both",
		bottom: true,
		narrowPane: "editor",
	};
	try {
		const stored = JSON.parse(sessionStorage.getItem(key) ?? "null");
		if (
			["both", "editor", "right"].includes(stored?.upper) &&
			typeof stored?.bottom === "boolean"
		)
			return {
				upper: stored.upper,
				bottom: stored.bottom,
				narrowPane: stored.narrowPane === "right" ? "right" : "editor",
			};
	} catch {
		/* Storage is optional. */
	}
	return fallback;
}

export function usePaneVisibility(consoleLesson: boolean) {
	const [narrow, setNarrow] = useState(
		() => window.matchMedia?.("(max-width: 900px)").matches ?? false,
	);
	useEffect(() => {
		const media = window.matchMedia?.("(max-width: 900px)");
		if (!media) return;
		const change = () => setNarrow(media.matches);
		media.addEventListener("change", change);
		return () => media.removeEventListener("change", change);
	}, []);
	const key = `coderunner:pane-visibility:${consoleLesson ? "console" : "robot"}`;
	const [saved, setSaved] = useState(() => ({
		key,
		value: readVisibility(key, consoleLesson),
	}));
	const [resetVersion, setResetVersion] = useState(0);
	if (saved.key !== key)
		setSaved({ key, value: readVisibility(key, consoleLesson) });
	const value =
		saved.key === key ? saved.value : readVisibility(key, consoleLesson);
	useEffect(() => {
		try {
			sessionStorage.setItem(saved.key, JSON.stringify(saved.value));
		} catch {
			/* Storage is optional. */
		}
	}, [saved]);
	const setUpper = (upper: UpperPanes) =>
		setSaved({ key, value: { ...value, upper } });
	const setNarrowPane = (narrowPane: "editor" | "right") =>
		setSaved({ key, value: { ...value, narrowPane } });
	return {
		editorVisible: narrow
			? value.narrowPane === "editor"
			: value.upper !== "right",
		rightVisible: narrow
			? value.narrowPane === "right"
			: value.upper !== "editor",
		bottomVisible: value.bottom,
		resetVersion,
		setEditorVisible: (visible: boolean) =>
			narrow
				? setNarrowPane(visible ? "editor" : "right")
				: setUpper(
						visible
							? value.upper === "right"
								? "both"
								: value.upper
							: "right",
					),
		setRightVisible: (visible: boolean) =>
			narrow
				? setNarrowPane(visible ? "right" : "editor")
				: setUpper(
						visible
							? value.upper === "editor"
								? "both"
								: value.upper
							: "editor",
					),
		setBottomVisible: (bottom: boolean) =>
			setSaved({ key, value: { ...value, bottom } }),
		reset: () => {
			try {
				for (const id of ["ide-rows", "ide-columns", "ide-console-columns"])
					sessionStorage.removeItem(`react-resizable-panels:${id}`);
			} catch {
				/* Storage is optional. */
			}
			setSaved({
				key,
				value: {
					upper: consoleLesson ? "editor" : "both",
					bottom: true,
					narrowPane: "editor",
				},
			});
			setResetVersion((version) => version + 1);
		},
	};
}

export type PaneVisibility = ReturnType<typeof usePaneVisibility>;
