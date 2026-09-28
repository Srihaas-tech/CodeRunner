/**
 * Seeds a project tree that stands in for what a student actually has in front
 * of them: a README, some nested docs, and a generated Gradle test report with
 * its own stylesheet, script, image and page-to-page links.
 *
 * The report is a trimmed copy of Gradle's real HTML test report structure —
 * `build/reports/tests/test/index.html` plus a `classes/` subpage, sharing
 * `css/`, `js/` and `img/` siblings — because that shape is exactly what the
 * relative-URL and asset-serving behaviour has to survive.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** A 1x1 red PNG. Small enough to inline, real enough for the browser to decode. */
const RED_PIXEL_PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	"base64",
);

async function write(
	projectPath: string,
	relativePath: string,
	contents: string | Buffer,
): Promise<void> {
	const target = join(projectPath, relativePath);
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, contents);
}

export type PreviewProjectOptions = {
	/** Overrides the README body; pass null to omit the README entirely. */
	readme?: string | null;
	/** Text the report's stylesheet colours the heading with. */
	reportHeadingColor?: string;
	/** Text the report's script writes into the page. */
	reportScriptMarker?: string;
};

export async function seedPreviewProject(
	projectPath: string,
	options: PreviewProjectOptions = {},
): Promise<void> {
	const {
		readme = DEFAULT_README,
		reportHeadingColor = "rgb(0, 128, 0)",
		reportScriptMarker = "script-ran",
	} = options;

	await mkdir(projectPath, { recursive: true });
	await write(projectPath, "build.gradle", "// e2e seed\n");

	if (readme !== null) {
		await write(projectPath, "README.md", readme);
	}
	await write(projectPath, "docs/guide.md", DEFAULT_GUIDE);
	await write(projectPath, "docs/images/diagram.png", RED_PIXEL_PNG);

	// Same filename at two depths — the picker has to keep them apart.
	await write(projectPath, "docs/notes/index.html", NESTED_INDEX_HTML);

	// Excluded trees: present on disk, never listed or served.
	await write(projectPath, ".git/config", "[core]\n");
	await write(projectPath, ".git/hooks/README.md", "# should not appear\n");
	await write(projectPath, ".gradle/cache/report.html", "<p>excluded</p>");
	await write(projectPath, "node_modules/pkg/readme.md", "# excluded\n");

	// A dot-directory that is NOT excluded: hand-written docs live in these.
	await write(projectPath, ".docs/hidden-notes.md", "# Hidden notes\n");

	// --- Generated Gradle-style test report ---
	const report = "build/reports/tests/test";
	await write(projectPath, `${report}/index.html`, reportIndexHtml());
	await write(
		projectPath,
		`${report}/classes/MyRobotTest.html`,
		reportClassHtml(),
	);
	await write(
		projectPath,
		`${report}/css/base.css`,
		reportCss(reportHeadingColor),
	);
	await write(
		projectPath,
		`${report}/js/report.js`,
		reportJs(reportScriptMarker),
	);
	await write(projectPath, `${report}/img/logo.png`, RED_PIXEL_PNG);

	// A file type the asset allowlist must refuse even though it sits beside the report.
	await write(projectPath, `${report}/secrets.properties`, "token=hunter2\n");
}

const DEFAULT_README = `# Robot Project

Welcome to the **robot** project.

## Getting started

Build the code, then run it. See [the guide](docs/guide.md).

Jump to [wiring](#wiring) below.

![A diagram](docs/images/diagram.png)

## Wiring

| Port | Motor |
| ---- | ----- |
| 1    | Left  |
| 2    | Right |

\`\`\`java
public class Robot {}
\`\`\`

<script>window.__mdRawHtmlRan = true;</script>
`;

const DEFAULT_GUIDE = `# Guide

Back to the [README](../README.md).
`;

const NESTED_INDEX_HTML = `<!doctype html>
<html><head><title>Nested index</title></head>
<body><h1 id="nested">Nested index</h1></body></html>
`;

function reportIndexHtml(): string {
	return `<!doctype html>
<html>
<head>
  <title>Test results</title>
  <link rel="stylesheet" href="css/base.css" type="text/css"/>
  <script src="js/report.js"></script>
</head>
<body>
  <h1 id="report-heading">Test Summary</h1>
  <img id="report-logo" src="img/logo.png" alt="logo"/>
  <p id="script-output">no script</p>
  <ul>
    <li><a id="to-class" href="classes/MyRobotTest.html">MyRobotTest</a></li>
  </ul>
  <button id="toggle" type="button">Toggle</button>
  <p id="toggle-output">closed</p>
</body>
</html>
`;
}

function reportClassHtml(): string {
	return `<!doctype html>
<html>
<head>
  <title>MyRobotTest</title>
  <link rel="stylesheet" href="../css/base.css" type="text/css"/>
</head>
<body>
  <h1 id="report-heading">MyRobotTest</h1>
  <img id="report-logo" src="../img/logo.png" alt="logo"/>
  <a id="to-index" href="../index.html">back</a>
</body>
</html>
`;
}

function reportCss(headingColor: string): string {
	return `#report-heading { color: ${headingColor}; }\n`;
}

function reportJs(marker: string): string {
	return `document.addEventListener("DOMContentLoaded", function () {
  document.getElementById("script-output").textContent = ${JSON.stringify(marker)};
  var toggle = document.getElementById("toggle");
  if (toggle) {
    toggle.addEventListener("click", function () {
      document.getElementById("toggle-output").textContent = "open";
    });
  }
});
`;
}
