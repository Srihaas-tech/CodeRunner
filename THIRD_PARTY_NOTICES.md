# Third-Party Notices

CodeRunner itself is licensed under the MIT License (see [`LICENSE`](./LICENSE)). It
redistributes the third-party software listed below, each of which remains under its own
license. This file reproduces the notices those licenses require.

Nothing here implies that any of the projects, organizations, or individuals named below
endorse or are affiliated with CodeRunner.

## Summary

| Component | Version | License | Where it ships |
| --- | --- | --- | --- |
| [AdvantageScope](https://github.com/Mechanical-Advantage/AdvantageScope) (**modified**) | v26.0.2 | BSD-3-Clause | AS Lite assets compiled into the control image |
| [PathPlanner](https://github.com/mjansen4857/pathplanner) (**modified**) | release artifact | MIT | web assets bundled into the control image |
| [VSCodium](https://github.com/VSCodium/vscodium) / Code – OSS (**modified**) | 1.126.04524 | MIT | `reh-web` build, base of the workspace image |
| [linuxserver/vscodium-web](https://github.com/linuxserver/docker-vscodium-web) image | 1.126.04524-ls35 | GPL-3.0 | base image, unmodified |
| [Eclipse Temurin JDK](https://adoptium.net/) | 17.0.15+6 and 21.0.12.1+1 | GPL-2.0 with Classpath Exception | project/simulation and JDT LS runtimes in the workspace image |
| [WPILib](https://github.com/wpilibsuite/allwpilib) | 2026 | BSD-3-Clause | jars primed into the workspace image's Gradle cache |
| [vscode-wpilib](https://github.com/wpilibsuite/vscode-wpilib) | 2026.1.1 | BSD-3-Clause | extension bundled in the workspace image |
| [AdvantageKit](https://github.com/Mechanical-Advantage/AdvantageKit) | — | BSD-3-Clause | referenced by the bundled `robot-starter` lesson |
| [redhat.java](https://github.com/redhat-developer/vscode-java) | 1.55.0 | EPL-2.0 | extension bundled in the workspace image |
| [vscjava.\*](https://github.com/microsoft/vscode-java-pack) Java extensions | see Dockerfile | MIT | extensions bundled in the workspace image |
| [vscode-spotless-gradle](https://github.com/badsyntax/vscode-spotless-gradle) | 1.2.1 | MIT | extension bundled in the workspace image |
| [GitHub CLI](https://github.com/cli/cli) | apt `stable` | MIT | installed in the workspace image |
| [Docusaurus](https://github.com/facebook/docusaurus) | see `website/package.json` | MIT | documentation site only |

Exact pinned versions live in [`containers/code/Dockerfile`](./containers/code/Dockerfile)
and [`.gitmodules`](./.gitmodules). Runtime npm dependencies carry their own licenses, listed
in `bun.lock` and the respective `package.json` files. AdvantageScope ships its own aggregated
dependency license list as `ThirdPartyLicenses.txt` alongside the AS Lite bundle.
The PathPlanner web bundle includes Flutter's generated dependency notices at
`assets/NOTICES`.

## Modifications

CodeRunner redistributes a **modified** build of AdvantageScope. The patch is kept at
source level in [`patches/advantagescope/001-lite-nt4-endpoint-injection.patch`](./patches/advantagescope/)
and injects an NT4 endpoint so AS Lite can run embedded in the CodeRunner page
(`/scope/?frcEndpoint=postMessage`).

CodeRunner redistributes a **modified** PathPlanner web build from the
[`mathewdunne/pathplanner-web`](https://github.com/mathewdunne/pathplanner-web)
fork. It adds an embedded entry point and HTTP-backed project file access for
CodeRunner. The upstream project remains copyright Michael Jansen.

CodeRunner also redistributes a **modified** VSCodium `reh-web` build. The
workspace image rewrites the stale VS Code revision in
`webviewContentExternalBaseUrlTemplate` — in `product.json` and in the compiled
`out/` where VSCodium inlines it — to the revision VSCodium 1.126 was actually
built from, so extension webviews can load their local assets. The edit is a
single revision string, applied in `containers/code/Dockerfile`; see
[`docs/decisions/036-vscodium-web-migration.md`](./docs/decisions/036-vscodium-web-migration.md).
The GPL-3.0 `linuxserver/vscodium-web` layer itself is unmodified.

No other bundled component is modified.

---

## PathPlanner

MIT License

Copyright (c) 2022 Michael Jansen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## AdvantageScope

Copyright (c) 2021-2026 Littleton Robotics. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

- Redistributions of source code must retain the above copyright
  notice, this list of conditions and the following disclaimer.
- Redistributions in binary form must reproduce the above copyright
  notice, this list of conditions and the following disclaimer in the
  documentation and/or other materials provided with the distribution.
- Neither the name of Littleton Robotics, FRC 6328 ("Mechanical Advantage"),
  AdvantageScope, nor the names of other AdvantageScope contributors may be
  used to endorse or promote products derived from this software without
  specific prior written permission.

THIS SOFTWARE IS PROVIDED BY LITTLETON ROBOTICS AND OTHER ADVANTAGESCOPE
CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT
NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY NONINFRINGEMENT
AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL
LITTLETON ROBOTICS OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

The same notice applies to **AdvantageKit**, also copyright Littleton Robotics.

---

## WPILib and vscode-wpilib

Copyright (c) 2009-2026 FIRST and other WPILib contributors
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
   * Redistributions of source code must retain the above copyright
     notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above copyright
     notice, this list of conditions and the following disclaimer in the
     documentation and/or other materials provided with the distribution.
   * Neither the name of FIRST, WPILib, nor the names of other WPILib
     contributors may be used to endorse or promote products derived from
     this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY FIRST AND OTHER WPILIB CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY NONINFRINGEMENT AND FITNESS FOR A PARTICULAR
PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL FIRST OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

---

## VSCodium and Code – OSS

MIT License

Copyright (c) 2018-present The VSCodium contributors
Copyright (c) 2018-present Peter Squicciarini
Copyright (c) 2015 - present Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

The same MIT terms cover the bundled `vscjava.*` Java extensions (Microsoft
Corporation), `vscode-spotless-gradle` (Richard Willis), the GitHub CLI
(GitHub, Inc.), and Docusaurus (Meta Platforms, Inc. and affiliates), each
under its own copyright holder.

---

## Components under copyleft licenses

These ship unmodified inside the workspace container image and are not linked into or
derived from CodeRunner's own code. Their full license texts are distributed with the
components themselves and are available upstream:

- **`linuxserver/vscodium-web` container image** — GNU General Public License v3.0.
  <https://github.com/linuxserver/docker-vscodium-web/blob/main/LICENSE>
- **Eclipse Temurin JDK 17 and 21** — GNU General Public License v2.0 with the Classpath
  Exception, which explicitly permits linking independent modules.
  <https://openjdk.org/legal/gplv2+ce.html>
- **`redhat.java` (Language Support for Java by Red Hat)** — Eclipse Public License 2.0.
  <https://github.com/redhat-developer/vscode-java/blob/master/LICENSE>

## Extension artifact sourcing

`vscode-spotless-gradle` is not published to Open VSX and its publisher does
not attach VSIX artifacts to GitHub releases. The workspace image therefore
builds version 1.2.1 from the publisher's pinned MIT-licensed source commit in
a throwaway Docker stage. No Visual Studio Marketplace artifact is downloaded
or redistributed.
