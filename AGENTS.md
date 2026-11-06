# AGENTS.md

## Purpose

This is the **small always-on contract** for AI coding agents working in YTT.

Keep this file compact. Do not add task history, long feature specifications,
roadmaps, implementation reports, or subsystem documentation here.

The user's explicit instruction overrides this file.

---

## Context budget: mandatory working style

Use the smallest context that can solve the task safely.

### Search first, read second

For each task:

1. define the exact scope;
2. search for relevant symbols/routes/components/services/events/tests;
3. identify the smallest plausible modification surface;
4. open those files and only the direct dependencies needed to understand them;
5. stop discovery once ownership, behavior, and change surface are clear.

Prefer targeted search (`rg`, focused repository/IDE search) over broad file reading.

Do **not** by default:

- reread the repository;
- read all docs;
- inspect unrelated modules "for context";
- recursively open neighboring files without evidence they matter;
- reread already-understood files unless they changed;
- inspect git history unless history is relevant;
- read the Development Control Center.

Before inventing a new pattern, search for the closest existing implementation.

Reuse existing actions/services, authorization patterns, realtime patterns,
React/Pixi patterns, design-system primitives, tests, and QA helpers.

Prefer focused tests and diagnostics first. Broaden validation only when the
change surface or risk requires it.

Do not repeatedly run the same expensive command without a reason.

---

## Documentation routing

Load deeper documentation only when needed:

| Need | Read |
|---|---|
| Product direction, major UX, architecture, scope | `docs/PRODUCT_VISION.md` — relevant sections only |
| Local setup/runtime | `docs/LOCAL_DEVELOPMENT.md` |
| Live browser/realtime QA | `docs/TEST_PLAYGROUND.md` |
| Production/deployment | `docs/DEPLOYMENT.md` |
| Historical local migration evidence | `docs/LOCAL_MIGRATION.md` |
| Historical validation evidence | `docs/VALIDATION.md` |

For subsystem work, search `docs/` for that subsystem before reading unrelated docs.

### Development Control Center

`YTT — Development Control Center`:

`C:\Users\vedut\OneDrive\Documents\ArtlllineObsidian\Main\20 Проекты\D&D - YTT Table\`

It contains roadmap, technical debt, priorities, deferred work, and major decisions.

Do not read or edit it automatically. Use it only when the user explicitly asks for
roadmap review, triage, recording a major decision, closing a module, or updating
the Control Center.

---

## Project identity

YTT is a self-hostable browser VTT centered on a polished Game Master workflow.

Core identity:

> tabletop + preparation workspace + live GM director console

It should feel like a premium creative tool/game editor, not an enterprise dashboard.

Default priorities:

- GM-first;
- player-simple;
- interaction quality before feature count;
- polished vertical slices before broad scaffolding;
- visual quality is part of correctness;
- fast preparation and live improvisation;
- system-agnostic core where practical.

Do not drift toward a Foundry clone, D&D Beyond clone, complete rules simulator,
character builder, marketplace, social platform, generic plugin platform, or
admin-dashboard product unless explicitly requested.

For detailed product philosophy and deferred scope, use `docs/PRODUCT_VISION.md`.

---

## Stack and local runtime

Baseline:

- Laravel 13 / PHP 8.3+;
- MySQL 8;
- React + TypeScript + Vite;
- PixiJS;
- Laravel Reverb/WebSockets;
- Redis only where actually required.

Local development is **native, not Docker-based**.

Do not use Docker/Compose for normal development tasks.

Current local environment uses Open Server PHP 8.3 and MySQL on `127.0.0.1:3306`.

Main local endpoints:

- app: `http://localhost:8090`;
- Reverb: `ws://localhost:8085`.

Use `.env` for configured endpoints. Never print secrets.

Normal launchers:

- `YTT-Start.bat`;
- `YTT-Stop.bat`.

Manual helper:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local.ps1 start
```

Use `docs/LOCAL_DEVELOPMENT.md` for detailed setup and commands.

Cue jobs must keep the `tabletop` database queue on the same MySQL connection as
application state. Do not move them to Redis without an explicit architecture change.

---

## Data and QA safety

PHP migration-based tests use the isolated SQLite in-memory configuration from
`phpunit.xml`. Never point them at persistent MySQL.

Use targeted tests first.

Before live browser/realtime QA, read `docs/TEST_PLAYGROUND.md`. Use **Полигон ·
движение и коллизии** (Scene 7) with the existing accounts, campaign, session, and
isolated browser contexts. Do not use the Townhouse background map (Scene 5) for
testing. Add persistent fixtures to Scene 7 when the user requests them.

Do not create replacement accounts/campaigns/scenes/sessions for routine QA when the
fixture is sufficient. Restore live mutations after checks where practical.

Never put credentials in tracked files, logs, reports, prompts, or memory.

Private campaign uploads live under `storage/app/campaigns-private`; do not expose
them publicly.

The private `.env` contains sensitive values. Never print or commit them.

Old Docker containers/volumes may remain as rollback data. They are not normal
development dependencies. Do not prune them, reset databases, or destroy local data
during ordinary development or QA.

---

## Architecture invariants

### Server authority

Laravel is authoritative for multiplayer/domain state.

Clients may use optimistic/presentation state, but shared canonical state is
validated and accepted server-side.

Validate membership, ownership, permissions, and mutations on the server.

### Secrets are filtered server-side

Never send GM-secret entities/fields to unauthorized players and rely on
client-side hiding.

Visibility filtering applies to both initial snapshots and realtime events.

### Realtime: snapshot + incremental updates

Use:

```text
snapshot -> hydrate -> subscribe -> incremental commands/events
```

Do not resend whole scenes for small mutations.

High-frequency interactions such as dragging must not persist every raw pointer
movement. Prefer responsive preview updates plus an authoritative final state.

### React vs Pixi

React owns application UI: panels, inspector, dialogs, library/browser UI,
combat/session/cue controls, settings.

PixiJS owns tabletop rendering: maps, tokens, props, grid, fog, drawings,
templates, effects, animated scene objects.

Do not model a complex tabletop scene as hundreds/thousands of ordinary DOM nodes.

### World state vs viewport state

Scene objects use world coordinates independent of viewport dimensions.
Pan/zoom belongs to camera state.

### Domain vs presentation state

Persist/shared domain state separately from transient state such as hover,
selection glow, local tween, context menus, or temporary drag previews.

Do not persist presentation-only state.

### Boundaries

Keep important behavior out of giant controllers/components.

Prefer existing application/domain actions and services.

Avoid giant React components, Pixi renderer files, Laravel services, and monolithic
global stores. Split by real responsibility, not arbitrary line counts.

---

## Engineering rules

Do not change frameworks, libraries, persistence, or realtime architecture without a
concrete benefit.

Do not create speculative generic managers, rules engines, plugin runtimes, or
abstraction layers without a real requirement.

Use normal Laravel migrations. Avoid destructive migrations without explicit need.
Provide migration paths when persisted formats change.

Security-sensitive changes must preserve:

- upload validation;
- private asset protection;
- membership/ownership checks;
- scene mutation authorization;
- appropriate rate limiting;
- rich-text sanitization where applicable;
- server-side secret filtering.

Performance matters most in hot tabletop paths. Avoid unnecessary React rerenders,
oversized realtime payloads, unnecessary broadcasts, full asset reloads, and
inappropriate global React state for renderer-hot data.

Measure before adding complex optimizations.

---

## UX rules

User-facing work must be both functional and polished.

The interface should remain dark-first, modern, restrained, cinematic, readable,
and comfortable for long GM sessions.

Keep the tabletop visually dominant.

Do not ship generic Laravel/React admin-dashboard styling.

Prefer contextual controls and progressive disclosure over permanent walls of
buttons.

Use drag-and-drop where natural and provide clear feedback.

Player UI must remain substantially simpler than GM UI.

Reuse the existing design system and interaction language before inventing new
patterns.

For major UX changes, read the relevant parts of `docs/PRODUCT_VISION.md`.

---

## Testing and Definition of Done

Tests should protect meaningful behavior, not inflate test counts.

Prioritize relevant coverage for:

- permissions/membership/ownership;
- secret filtering;
- realtime authorization/synchronization;
- persistence;
- affected cue/trigger behavior;
- critical interaction/state logic;
- regressions caused by the task.

A user-facing change is normally done when applicable items are satisfied:

1. behavior works;
2. authorization is correct;
3. persistence/reload is correct;
4. multiplayer behavior is correct;
5. loading/failure states are reasonable;
6. interaction and visuals fit YTT;
7. obvious edge cases are handled;
8. relevant automated tests pass;
9. the real workflow is manually validated when useful;
10. docs change only when behavior/architecture materially changed.

Do not use destructive live-data QA where isolated tests can prove the behavior.

---

## Agent workflow

For a normal task:

1. read the task and this file;
2. decide whether deeper docs are actually required;
3. search for relevant entrypoints;
4. inspect the smallest coherent implementation/test set;
5. reuse existing patterns;
6. make the smallest coherent change that fully solves the task;
7. run focused validation;
8. broaden validation only when risk justifies it;
9. manually validate the real workflow when useful;
10. report concisely.

Before a new subsystem, architecture change, major UX pattern, dependency, or product
scope expansion, read the relevant on-demand documentation.

Do not perform unrelated cleanup in a focused task unless correctness requires it.
Report unrelated technical debt separately instead of silently expanding scope.

---

## Completion report

Keep final reports compact:

- what changed;
- important decision(s);
- validation/tests and result;
- remaining blocker/risk/follow-up, if any.

Do not restate the task, dump large diffs, list every touched line, or repeat repo docs.

---

## Final rule

Prefer improving a repeated GM workflow over adding more mediocre features.

Prefer an implementation that fits YTT over a generic implementation that is merely
easier for the agent.

Make the GM's repeated actions fast, reliable, understandable, and pleasant.
