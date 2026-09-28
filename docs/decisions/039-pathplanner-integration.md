# 039 — PathPlanner integration

Status: **Accepted** — 2026-08-30

## Context

Students should be able to edit PathPlanner paths/autos in the browser IDE.
A fork (`mathewdunne/pathplanner-web`) adapts the Flutter GUI to the web:
it hydrates an in-memory copy of the project's deploy tree over HTTP and
mirrors every mutation back. Design spec and implementation plan live in
that repo (`docs/superpowers/specs/2026-08-30-coderunner-web-design.md`).

## Decision

- **Deploy-files API** (additive, `/u/:slug/api/deploy-files/...` behind
  `requireWorkspaceOwnership`): one `snapshot` GET returning every file
  under `src/main/deploy/pathplanner/**` (read-write) and
  `src/main/deploy/choreo/**` (read-only), plus per-file PUT/DELETE
  restricted to the pathplanner subtree. Paths are validated by a shared
  contracts schema (safe segments, no dotfiles, 512 max); files are capped
  at 5 MB. DELETE of a missing file is 404 (the client treats it as
  success). No rename op — the client decomposes to PUT + DELETE.
- **Serving**: the Flutter web build is static-served at `/pathplanner/`
  (public GET like `/scope/`; identity comes from the session cookie on
  the API calls the embedded app makes). The shell iframes
  `/pathplanner/?ws=<slug>`.
- **Packaging**: a prebuilt `pathplanner-dist.tar.gz` from the fork's
  GitHub releases, fetched by `scripts/fetch-pathplanner-dist.ts` and baked
  into the control image by a dedicated Dockerfile stage. Flutter never
  enters this repo's toolchain. Whether a missing artifact is fatal depends
  on the caller: it is **required** for release paths (`bun run build`, and
  the control image whenever `PATHPLANNER_DIST_TAG` names a real release
  tag — which `release.yml` pins so both arch builds resolve the same
  artifact) and **optional** for demo/recovery paths (`fetch:dist`, and a
  local `docker:build:control`, which leaves the tag at `latest`). When it
  is skipped, `/pathplanner/` serves a 503 and everything else is
  unaffected.
- **UI**: a topbar tab selector switches the right-hand pane between
  AdvantageScope and PathPlanner. Both iframes stay mounted when hidden so
  their live state is preserved, and the selected tab persists for the browser
  session. A project swap reloads the PathPlanner iframe to fetch the new
  snapshot. Plain-Java console modules hide the tabs and simulation panes.

## Consequences

- External edits (VSCodium, lesson load, imports) reach PathPlanner only
  on iframe reload — accepted for v1. Project swaps trigger that reload;
  ordinary edits made in VSCodium require a manual reload.
- NT4 telemetry/hot-reload is deferred: the NT4 proxy pins the upstream
  client name to `AdvantageScopeLite`, so a second client needs a name
  passthrough (recorded in the fork's spec).
