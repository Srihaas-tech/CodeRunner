# CodeRunner

A self-hosted, browser-based IDE for learning FRC robot programming. Students get a hosted VS Code editor, isolated Docker workspaces, one-click robot simulation, live AdvantageScope telemetry, and PathPlanner — all with no local setup. Lesson modules guide beginners, while GitHub team import supports real robot projects.

## Quick Start

Try CodeRunner locally in demo mode — no OAuth, no allowlist, no configuration required. Just Docker:

```bash
git clone https://github.com/mathewdunne/CodeRunner coderunner
cd coderunner
CODERUNNER_DEMO_MODE=1 docker compose up
```

Open [http://localhost:4000](http://localhost:4000). You land directly in the IDE as a single seeded admin user.

**Prerequisites:** Docker with the Compose plugin (running). No Bun, Flutter, submodules, or emscripten needed — the control image ships the web shell, AdvantageScope, and PathPlanner assets prebuilt. On macOS and native Windows there is nothing to configure; on **Linux and WSL2** (Docker Desktop's WSL2 integration included) the socket belongs to the `docker` group, so prefix the command with `CODERUNNER_DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)` or set that variable in `.env`.

> **Warning:** Demo mode bypasses authentication entirely. Every visitor shares the same admin user and workspace. Do not expose a demo instance to the public internet. See [docs/quick-start.md](docs/quick-start.md) for full details and next steps.

## Documentation

Documentation lives in [`docs/`](docs/) and is built with [Docusaurus](https://docusaurus.io/) from [`website/`](website/). To browse locally:

```bash
cd website && bun install && bun run start
```

Or from the repo root:

```bash
bun run docs:dev
```

Main sections:

- [Quick Start](docs/quick-start.md) — demo mode walkthrough
- [Using CodeRunner](docs/using-coderunner.md) — student guide: projects, running a simulation, PathPlanner
- [Architecture](docs/about/architecture.md) — how the system is put together
- [Lessons & Modules](docs/lessons/overview.md) — lesson catalog, module authoring, GitHub import
- [Deploying](docs/deploying/overview.md) — running a real multi-user instance
- [Day-to-Day Operations](docs/operating/day-to-day.md) — managing a live deployment
- [Development Setup](docs/development/dev-servers.md) — running the app locally for development
- [Configuration Reference](docs/reference/configuration.md) — all environment variables

## Development

Start the control plane and web shell in parallel:

```bash
bun run dev:control   # Bun control plane on :4000 with --watch
bun run dev:web       # Vite web shell on :5173 with HMR
```

Run the full verification suite before submitting changes:

```bash
bun run verify        # typecheck + Bun tests + Vitest + Playwright
```

See [docs/development/dev-servers.md](docs/development/dev-servers.md) for the full development workflow.

## License

CodeRunner is released under the [MIT License](LICENSE).

It redistributes third-party software that remains under its own terms — most notably [AdvantageScope](https://github.com/Mechanical-Advantage/AdvantageScope) (BSD-3-Clause, modified), [PathPlanner](https://github.com/mjansen4857/pathplanner) (MIT, modified), [VSCodium](https://github.com/VSCodium/vscodium) (MIT), and [WPILib](https://github.com/wpilibsuite/allwpilib) (BSD-3-Clause). Required notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and ship inside both images at `/usr/share/coderunner/`. None of those projects endorse or are affiliated with CodeRunner.
