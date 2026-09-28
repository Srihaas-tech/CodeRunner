---
sidebar_position: 3
title: Licenses
---

# Licenses

CodeRunner is released under the **MIT License**. It redistributes third-party software that
remains under its own terms.

This page is a summary. The authoritative, complete notices — including the full license
texts the BSD-3-Clause components require — are in
[`THIRD_PARTY_NOTICES.md`](https://github.com/mathewdunne/CodeRunner/blob/main/THIRD_PARTY_NOTICES.md)
in the repository, and ship inside both container images at `/usr/share/coderunner/`.

None of the projects, organizations, or individuals listed below endorse or are affiliated
with CodeRunner.

## CodeRunner

MIT License, Copyright © 2026 Mathew Dunne and CodeRunner contributors. Full text:
[`LICENSE`](https://github.com/mathewdunne/CodeRunner/blob/main/LICENSE).

You may use, copy, modify, and redistribute CodeRunner, including commercially, provided the
copyright notice and permission notice are included. It comes with no warranty.

## Bundled third-party software

| Component | License | Where it ships |
| --- | --- | --- |
| [AdvantageScope](https://github.com/Mechanical-Advantage/AdvantageScope) (**modified**) | BSD-3-Clause | Telemetry view, compiled into the control image |
| [PathPlanner](https://github.com/mjansen4857/pathplanner) (**modified**) | MIT | Path and auto editor, bundled into the control image |
| [VSCodium](https://github.com/VSCodium/vscodium) / Code – OSS (**modified**) | MIT | The editor (`reh-web` build), base of the workspace image |
| [linuxserver/vscodium-web](https://github.com/linuxserver/docker-vscodium-web) image | GPL-3.0 | Workspace base image, unmodified |
| [Eclipse Temurin JDK 17 and 21](https://adoptium.net/) | GPL-2.0 with Classpath Exception | Project/simulation and JDT LS runtimes in the workspace image |
| [WPILib](https://github.com/wpilibsuite/allwpilib) | BSD-3-Clause | Robot libraries and simulator |
| [vscode-wpilib](https://github.com/wpilibsuite/vscode-wpilib) | BSD-3-Clause | WPILib editor tooling |
| [AdvantageKit](https://github.com/Mechanical-Advantage/AdvantageKit) | BSD-3-Clause | Referenced by the bundled starter lesson |
| [redhat.java](https://github.com/redhat-developer/vscode-java) | EPL-2.0 | Java language support |
| [vscjava.\*](https://github.com/microsoft/vscode-java-pack) Java extensions | MIT | Debugger, tests, Gradle, project view |
| [vscode-spotless-gradle](https://github.com/badsyntax/vscode-spotless-gradle) | MIT | Code formatting |
| [GitHub CLI](https://github.com/cli/cli) | MIT | Repository import and push |
| [Docusaurus](https://github.com/facebook/docusaurus) | MIT | This documentation site |

Exact pinned versions are in
[`containers/code/Dockerfile`](https://github.com/mathewdunne/CodeRunner/blob/main/containers/code/Dockerfile).
AdvantageScope ships its own aggregated dependency license list as `ThirdPartyLicenses.txt`
alongside the bundled telemetry view.
PathPlanner ships Flutter's generated dependency notices as `assets/NOTICES`.

## Modifications

CodeRunner redistributes a **modified** build of AdvantageScope. The change is kept as a
source-level patch in
[`patches/advantagescope/`](https://github.com/mathewdunne/CodeRunner/tree/main/patches/advantagescope)
and injects an NT4 endpoint so the telemetry view can run embedded in the CodeRunner page.

CodeRunner also redistributes a **modified** PathPlanner web build. The
[`mathewdunne/pathplanner-web`](https://github.com/mathewdunne/pathplanner-web)
fork adds CodeRunner's browser file-sync interface and embedded entry point.

The workspace image also ships a **modified** VSCodium build: it rewrites one stale VS Code
revision string in the editor's webview configuration so extension webviews can load their
local assets. The GPL-3.0 `linuxserver/vscodium-web` layer itself is unmodified.

No other bundled component is modified.

## What this means for you

- **Running an instance.** Self-hosting CodeRunner for your team requires nothing beyond
  keeping the license files intact.
- **Forking or redistributing.** Keep `LICENSE` and `THIRD_PARTY_NOTICES.md` with the copy you
  distribute. The BSD-3-Clause components require their copyright notice, conditions, and
  disclaimer to travel with both source and binary redistributions — including container
  images.
- **Naming.** The BSD-3-Clause components carry a no-endorsement clause. You may describe
  AdvantageScope, WPILib, or AdvantageKit factually as components you bundle, but may not use
  the names of Littleton Robotics, FRC 6328, FIRST, WPILib, or their contributors to promote a
  derived product without written permission.

## Lesson content

Bundled lesson modules under `catalog/` include their own license files where the starter code
derives from upstream projects — for example
`catalog/modules/robot-starter/WPILib-License.md` and `AdvantageKit-License.md`. Lessons you
author or import carry whatever license you give them.
