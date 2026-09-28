# 041 — Project Preview (Markdown + generated HTML reports)

Status: **Accepted** — 2026-09-12

## Context

Students need to read their project's own documents beside the editor:
lesson instructions in `README.md`, and the HTML reports Gradle generates
under `build/reports/**`. VSCodium's built-in Markdown preview is not an
option — decision 036 records that VSCodium webviews load from
`vscode-cdn.net`, which breaks on a locked-down school network and cannot
be framed by the control plane. A CDN-hosted renderer has the same problem.

A generated Gradle report is not a single file. It is a tree of pages that
link to each other and pull in their own `css/`, `js/` and `img/` siblings
by relative URL. Anything that serves only one file at a time renders it
unstyled and inert, so the delivery model had to be settled before any UI
was built on top of it.

## The blocking constraint we found first

Project HTML is executable, student-authored content. Framing it with
`sandbox="allow-scripts"` and **without** `allow-same-origin` is what keeps
a report's scripts away from the CodeRunner shell — but that same choice
gives the framed document an **opaque origin**, and a browser computes a
null site-for-cookies for an opaque origin. The `SameSite=Lax` session
cookie is therefore dropped from everything the frame requests.

Measured in Chromium against a local server before committing to a design:

| Request | Session cookie |
| --- | --- |
| Top-level page | sent |
| Iframe document (parent-initiated navigation) | sent |
| Stylesheet / script / image from inside the frame | **not sent** |
| Link navigation inside the frame | **not sent** |

So "authenticate every preview request with the session cookie" and "deny
the frame same-origin privileges" are mutually exclusive. Serving the whole
report from a second origin would resolve it properly, but costs a DNS
name, a Caddy vhost, certificate coverage and deploy changes.

## Decision

- **A signed path token carries the grant.** `GET /u/:slug/api/preview/documents`
  stays behind `requireWorkspaceOwnership` (an ordinary same-origin fetch
  from the shell, so the cookie is present) and returns the document list
  plus a token. Resources are then served from
  `GET /u/:slug/api/preview/files/<token>/<path>`. Because a report's links
  are relative, the browser rebuilds every follow-up URL from the current
  one and the token segment is inherited automatically — the report needs
  to know nothing about it.
  - The token is `HMAC-SHA256(sessionSecret, "coderunner.preview.v1.<workspaceId>.<exp>")`,
    base64url, with a 15-minute TTL. The workspace id is inside the signed
    message, so one student's token does not verify against another
    student's slug.
  - This is the **only** workspace route dispatched ahead of the cookie
    ownership check, and it is read-only and GET-only. `workspace-routes.ts`
    carries a comment saying so, because the exception is otherwise
    indistinguishable from a mistake.
  - Cost accepted: a capability in a URL. Mitigated by the short TTL,
    `Referrer-Policy: no-referrer`, and `Cache-Control: no-store, private`.
    Capability-bearing request paths are redacted from structured HTTP logs.
    It authorises exactly the tree its owner could already read.
- **Isolation is applied twice.** The iframe carries
  `sandbox="allow-scripts"`, and every document response repeats the policy
  as a `Content-Security-Policy: sandbox …` header, so opening a report URL
  directly is isolated the same way. `'self'` is useless in a CSP for an
  opaque-origin document — it matches nothing — so resource directives name
  the response's own token-scoped path prefix instead. `connect-src`,
  `form-action`, `frame-src`, `worker-src` and `object-src` are `'none'`.
  `navigate-to 'none'` adds best-effort protection against scripted
  navigation exporting the capability URL.
  Markdown gets the stricter variant with no `allow-scripts` at all.
  Directly navigable SVG assets get document isolation too.
- **Markdown renders in-process** with `markdown-it` (`html: false`),
  local CSS and system fonts. Headings get stable slugs so hand-written
  `#anchor` links resolve. No CDN, webfont, or highlighting bundle.
- **HTML reports are served byte-for-byte**, with a narrow MIME allowlist
  for their assets (CSS, classic JS, common images including SVG, fonts).
  Source and config files beside a report are refused with 415 — this
  handler must not become a way to read a project's files back out through
  the browser.
- **Discovery is bounded and honest**: 2,000 documents, 20,000 visited
  entries, depth 32, 10 MiB per document, 25 MiB per asset. The walk is
  breadth-first so a budget leaves a shallow, useful listing. Hitting one
  sets `truncated: true`, which the picker shows.
- **`.git`, `.gradle` and `node_modules` are excluded by name**; other
  dot-directories are not, because hand-written docs live in them.
  `.gitignore` is deliberately *not* the filter — `build/reports/**` is
  gitignored and is exactly what students need.
- **Symlinks are refused** on both the walk and the read, and the file
  actually opened is verified through `/proc/self/fd` before its bytes are
  used, closing the check-then-use race on a tree the student can write to.
- **UI**: Preview is a third tab beside AdvantageScope and PathPlanner in
  the existing topbar selector, in the existing right pane. All three
  panels stay mounted. Refresh re-reads the list *and* remounts the frame
  with a fresh token, which is what forces the document's CSS, scripts and
  images to be re-fetched; it starts the document at the top. There is no
  watcher, poll, post-run trigger, or scroll restoration.
- **Console (`plain-java`) lessons get Preview too**, via a show/hide
  button in the selector's slot. `IDELayout`'s single `showSimPanels` flag
  was split into `showRightPane` and `showDriverStation` so the Preview
  pane can appear without dragging the Driver Station or the simulator
  hooks back in with it.

## Tested compatibility boundary

Proven in a real browser (`e2e/specs/preview/delivery.spec.ts`) against a
Gradle-shaped report fixture: local stylesheet applied, classic script ran
and stayed interactive, local image decoded, page-to-page navigation in
both directions including parent-relative asset references, and Markdown
rendering with all off-origin requests blocked. Isolation is asserted
directly: opaque origin, parent DOM blocked, `localStorage` blocked,
authenticated API calls blocked.

Outside the boundary, and expected to need later work if it ever comes up:
reports needing remote CDNs, a backend API, ES modules with cross-origin
requirements, or browser storage. Externally hosted images in a Markdown
file are not made to work offline by this feature.

## Alternatives rejected

- **Add `allow-same-origin`.** Restores cookie auth, but hands report
  scripts the shell's origin: authenticated API calls, app storage, parent
  DOM. Fails the isolation requirement outright.
- **A `SameSite=None; Secure` preview cookie.** Browsers require `Secure`,
  which breaks plain-http local dev and the demo stack, and the cookie then
  rides along on any cross-site request to the app.
- **A second origin for preview.** The right long-term answer and still
  open to us, but it costs DNS, a Caddy vhost, certificates and deploy
  changes, and still needs a cross-origin token handoff.
- **Inlining assets into one document.** Cannot represent a multi-page
  report tree.

## Consequences

- One new dependency (`markdown-it`) in the control plane.
- `apps/control/src/app/assets.ts` gains `isOpenFileInsideRoot`, the
  descriptor-verification helper. `deploy-files.ts` keeps its own private
  copy; it was not refactored, per the surgical-changes rule.
- `/u/:slug/api/preview/files/*` is templated in `metrics.ts` so neither
  the token nor a project path can become a metric label.
