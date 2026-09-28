---
sidebar_position: 2
title: Testing
---

# Testing

This page covers the test suite you'll run while working on CodeRunner. The
default verification tiers are runnable without Docker and without external
services; the targeted Java workspace smoke requires Docker and a locally
built image. For the CI gate that runs the default tiers in sequence, see
[Development Servers](./dev-servers.md).
For the full script list, see the [CLI reference](../reference/cli-reference.md).

## First-time setup

Install Playwright's browser binary once after `bun install`:

```bash
bunx playwright install chromium
```

## Test tiers

### `bun run test`: control-plane unit and integration tests

```bash
bun run test
```

Runs Bun's built-in test runner across the control plane
(`apps/control/`), shared contracts (`packages/contracts/`), scripts
(`scripts/`), and the two frontend files that live in Bun test style
(`apps/web/src/lib/keyboard-mapping.test.ts` and
`keyboard-mapping.property.test.ts`). Coverage includes:

- Authentication: session creation, cookie HMAC signing, allowlist enforcement, role gating
- Proxy layer: hop-by-hop header stripping, WebSocket upgrade, base-path routing
- Run manager: build lifecycle, timeout handling, state recovery, concurrent-run gating
- Lessons catalog: bundled catalog load, module discovery, catalog integrity
- PathPlanner: deploy-file access controls and static asset routing
- Preview: document discovery, file serving, path safety, and signed tokens
- Security: SSRF/path-traversal/command-injection validators, admin-route enumeration
- Property-based tests via `fast-check`: URL validation, slug generation, contract schema round-trips, audit-filter SQL parameterization
- Metrics: route-templating cardinality

### `bun run test:web`: frontend unit and component tests

```bash
bun run test:web
```

Runs Vitest inside `apps/web/`. Coverage includes:

- React hooks: `useSession`, `useLessons`, `useSimulationState`, `useContainerStatus`, `useAutoChoosers`, `useGamepad`, `useRunChannel`
- DriverStation components: Enable/Disable button state machine, mode switching
- Zustand store: input-mode transitions, gamepad selection persistence
- Keyboard and gamepad mappings
- PathPlanner iframe URL, pane switching, keyboard navigation, and saved tab choice
- Preview document loading, selection, refresh, and failure states

### `bun run e2e`: Playwright mocked tier

```bash
bun run e2e
```

Runs the Playwright test suite against the `mocked` project. No Docker
daemon required. Each test gets a fully isolated control-plane instance;
see [Fixture architecture](#fixture-architecture) below. Covers the full
login→editor→run→telemetry→driver-station flow, including:

- Auth: session isolation, cross-workspace 403 gating, allowlist enforcement, role gating
- Editor proxy: iframe load, WebSocket upgrade, hop-by-hop header stripping, asset base path
- Run lifecycle: build→running→stopped transitions, build failures, timeout handling, state recovery after crash, concurrent-run rejection
- Driver Station: enable/disable payload shape, mode switching, multi-tab sync
- Gamepad: controller selection persistence across run cycles, unplug-while-enabled safety, pre-run no-lease behavior, keyboard tile focus gating, auto-chooser refresh on restart
- Telemetry: AdvantageScope iframe load, NT4 per-workspace isolation
- Sim pane tools: AdvantageScope selected first, the PathPlanner iframe mounted while hidden, tab switching without unloading it, the tab choice surviving a reload, and a project swap reloading PathPlanner
- Preview: Markdown and HTML delivery, refresh, project switching, console lessons, and browser isolation
- Admin: capacity cap enforcement, audit log entries, user management
- Public routes: health check, OpenAPI endpoint

Some browser-heavy specs that depend on `data-testid` attributes not yet
added to components are marked `test.fixme`; they appear in Playwright
reports as expected-not-implemented markers and do not fail the suite.
Their HTTP-layer counterparts run as normal tests.

### `bun run e2e:workspace-java`: real Java workspace smoke

```bash
bun run docker:build:workspace
bun run e2e:workspace-java
```

Runs a targeted Playwright test against fresh containers from the real
workspace image. It opens `hello-world` in real VSCodium, verifies that JDT LS
uses Java 21, waits for `Java: Ready`, launches **Run Main** with F5, verifies
`Hello, World!`, and
asserts that JDT logs enumerate `vscode.java.resolveMainMethod` without any
`No delegateCommandHandler` error. It then opens `robot-starter`, waits for
the real Gradle import, invokes **WPILib: Build Robot Code**, verifies that
WPILib generated a Java 17 command and launched its Gradle daemon on Java 17,
rejects Spotless/JDK failures, checks Java 17 classfiles, and starts/stops the
supported `start-sim.sh` → `run-sim.sh` path.

This focused tier is intentionally outside `bun run verify`: it requires a
Docker daemon, a prebuilt multi-gigabyte image, and several minutes. Run it
whenever the JDK, VSCodium base, Java/WPILib extensions, or workspace startup
logic changes.

### `bun run e2e:security`: security E2E tests

```bash
bun run e2e:security
```

Runs the `security` Playwright project (specs under `e2e/specs/security/`).
Covers CSRF gating on state-changing endpoints, XSS output encoding in the
run console and admin pages, and response-header policy (`Content-Security-Policy`,
`X-Frame-Options`, `X-Content-Type-Options`, `SameSite` cookie attributes).

Preview security tests cover sandboxing, response headers, API isolation, and
cross-workspace access.

### `bun run verify`: full CI gate

```bash
bun run verify
```

Runs `biome ci .`, then `bun run typecheck`, then all four test tiers in
order: `test`, `test:web`, `e2e`, `e2e:security`. This is the local
equivalent of CI. Run it before opening a pull request. See
[Development Servers](./dev-servers.md) for what `typecheck` covers.

## Fixture architecture

The E2E suite runs the control plane in-process: Playwright never launches
`main.ts` as an external subprocess. Each `test()` calls `createApp()` directly
inside the worker process and binds a `Bun.serve` listener on a random port.
This gives tests direct access to the `ControlApp` instance for seeding and
inspection without test-only HTTP routes.

Key properties of each isolated test environment:

- **Temporary directory**: each test gets a fresh `mkdtemp` root that is deleted on teardown.
- **Own SQLite database**: the control plane's `dbPath` points inside that tempdir.
- **Random port**: pre-allocated via a throwaway `Bun.serve({ port: 0 })` so the `baseUrl` baked into auth config matches the actual server address.
- **Seeded auth**: `loginAs` in `e2e/fixtures/auth.ts` writes directly to the `user` and `session` tables and HMAC-signs the session cookie. No OAuth round trip is required and no test-only production code exists.

The fixture exposes four handles to each test:

| Handle | What it is |
|---|---|
| `app` | The in-process `ControlApp` for direct seeding/inspection |
| `baseURL` | `http://127.0.0.1:<port>` for Playwright navigation |
| `runtime` | The `MockWorkspaceRuntimeProvider` for seeding workspace state |
| `fakeVscode` / `fakeHalsim` | In-process fake servers (see below) |

### In-process fake servers

`e2e/fixtures/fake-vscode.ts`: a Bun HTTP+WS server on an ephemeral port.
Returns a sentinel HTML page (`data-fake-vscode-ready="true"`) for iframe-load
assertions, accepts WebSocket upgrades, records received headers and frames,
and exposes `receivedHeaders()` / `receivedFrames()` / `awaitWsConnection()`
for proxy assertions.

`e2e/fixtures/fake-halsim.ts`: a Bun WS server the control plane connects to
as the HALSim bridge. Records every JSON frame received from the control plane,
exposes `pushFrame()` to inject upstream frames, and `connections()` to assert
connection state. Supports `restart()` for transient-unavailability tests.

`e2e/fixtures/fake-nt4.ts`: a minimal NT4 server for telemetry isolation
tests. Sends configurable topic-announcement frames on connect; records
subscribe frames from the control plane.

`e2e/fixtures/gamepad-shim.ts`: injected into the browser via
`page.addInitScript`. Overrides `navigator.getGamepads()` and dispatches
`gamepadconnected` / `gamepaddisconnected` events. Helper functions
`connectGamepad`, `disconnectGamepad`, `setGamepadAxes`, and `setGamepadButton`
drive gamepad state from test code via `page.evaluate()`.

`e2e/fixtures/runtime.ts`: helpers (`seedRuntimeRunning`,
`seedRuntimeMissing`) that configure the `MockWorkspaceRuntimeProvider` with
fake endpoint URLs pointing at the in-process fake servers, plus
`seedWorkspaceProject` for specs that need a non-empty project (an empty one
auto-opens the Switch Project dialog).

The two tool panes are served from throwaway dists built by
`createAdvantageScopeDist` / `createPathPlannerDist` in
`apps/control/src/__tests__/helpers.ts` — not the real builds, so the mocked
tier needs neither emscripten nor a PathPlanner download. The fake PathPlanner
page counts its own loads in `sessionStorage` and publishes the count as
`data-fake-pathplanner-loads` on `<body>`: a project swap remounts that iframe
without changing its `src`, so the counter is the only way to observe the
reload.

## Debugging helpers

```bash
bun run e2e:ui       # Playwright UI mode: step through tests visually
bun run e2e:debug    # PWDEBUG=1: open Playwright Inspector on launch
bun run e2e:report   # Open the last HTML report with traces
```

Traces, screenshots, and videos are retained on failure automatically
(configured in `playwright.config.ts`). Use `e2e:report` to open them after
a failed run.

## Playwright project names

The `playwright.config.ts` defines three projects:

| Project | Command | Scope |
|---|---|---|
| `mocked` | `bun run e2e` | All specs except `smoke-docker/` and `security/` |
| `security` | `bun run e2e:security` | Specs under `e2e/specs/security/` |
| `docker-smoke` | `bun run e2e:workspace-java` | Real VSCodium/JDT/Java/WPILib smoke under `e2e/specs/smoke-docker/`; requires Docker and a built workspace image |
