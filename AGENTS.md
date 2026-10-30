# AGENTS.md

## 1. Purpose of this document

This file is the primary product and engineering contract for all AI coding agents working in this repository.

Read this document before making architectural decisions, creating major subsystems, changing UX patterns, introducing dependencies, or expanding product scope.

The goal is not to produce code as quickly as possible.

The goal is to build a polished, coherent, enjoyable virtual tabletop that feels intentionally designed for a Game Master rather than assembled from unrelated features.

When implementation choices conflict with this document, prefer this document unless the user explicitly overrides it.

## 1.1. Current local runtime — Docker Compose

**The project already has a working Docker-based local test environment**, verified
on Windows with Docker Desktop / Linux containers on 2026-10-29. Use this environment
for local application runs and integration checks. Inspect its current state rather
than assuming containers are still running. A separate host PHP/MySQL/Redis/Node
installation is not required for the Docker workflow.

Read [docs/DOCKER.md](docs/DOCKER.md) for the Russian user guide and
[docs/VALIDATION.md](docs/VALIDATION.md) for verification evidence and limits.
The Docker configuration is a local test setup; public VPS deployment remains
documented separately in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

### Launch, stop and verify

Docker Desktop must be running with the Linux Engine ready. From the project root:

```powershell
# Build the current code and start the complete environment.
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\docker.ps1 up

# Inspect containers, application dependencies, or run isolated automated tests.
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\docker.ps1 status
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\docker.ps1 doctor
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\docker.ps1 test

# Stop and remove the environment's containers while preserving its data volumes.
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\docker.ps1 down
```

For the user, prefer the existing double-click entry points in the repository root:

- `YTT-Start.bat`: runs `up -OpenBrowser`, waits for readiness, then opens the site.
- `YTT-Stop.bat`: runs `down`, preserving campaign data and uploaded files.

Default application URL: **http://localhost:8090**. Default browser WebSocket:
**ws://localhost:8085**. Both ports bind only to loopback. Respect configured values
in `.env.docker` if the user changes them. No shared accounts or demo campaign are
seeded; users register through the application.

The current local Docker volumes are **not empty**: on 2026-10-29 the existing
host test dataset was copied into Docker at the user's request, preserving account
password hashes, relationships, private files and the matching source APP_KEY.
The restore contained 17 users, 13 campaigns, 34 scenes and 414 asset records;
43 tables and 1014 private files were verified. Treat this as existing prepared
data. Fresh installations still start without seeded accounts. The original host
database/files and the Docker copy are independent after the transfer.

For direct Compose commands, always specify the Docker environment file, for example:

```powershell
docker compose --env-file .env.docker ps --all
docker compose --env-file .env.docker logs --tail 100 app reverb queue scheduler
```

**Source code is copied into images, not bind-mounted.** After code changes, run
`up` to rebuild before validating in the browser or running image-based PHP tests.
Restarting an existing container alone does not load edited source. The interface
is served from `public/build`; this setup does not run Vite HMR.

### Services and application contracts

- Compose project: `ytt-test`; application image: `ytt-local:dev`.
- `app`: PHP 8.4 / Apache, Laravel and the built React/PixiJS interface.
- `mysql`: MySQL 8.4; `redis`: Redis 7.4 for sessions and cache.
- `reverb`: WebSocket service; `queue`: Cue worker; `scheduler`: Laravel scheduler.
- `init`: prepares writable storage and applies normal migrations before startup.
  Its `Exited (0)` state is expected, not a service failure.
- `frontend`: optional Node 22 tools image (`ytt-frontend:dev`) for frontend checks.

Containers reach MySQL at `mysql:3306`, Redis at `redis:6379`, and Reverb at
`reverb:8080`. Browser clients use the separate `REVERB_PUBLIC_*` configuration.
Preserve this separation; Docker service names are not browser hostnames.

The Cue worker uses the existing `tabletop` database queue on the **same MySQL
connection as application state**. Do not switch that queue to Redis. Preserve
`SIGTERM` for PHP CLI services; the Apache image's default `SIGWINCH` is used by
the web service and does not correctly stop the CLI workers.

The `test` helper runs PHP tests in a disposable container with SQLite in memory,
temporary storage and explicit test environment overrides, then frontend tests.
Use it instead of running migration-based tests against the persistent Docker MySQL.
Health checks and `doctor` complement, but do not replace, real browser/realtime
verification for changes that affect multiplayer behavior.

### Configuration and persistent data

`scripts/docker.ps1` generates `.env.docker` from `.env.docker.example` only on first
startup, including random APP_KEY, MySQL passwords and Reverb credentials. Preserve
that file and its keys; do not print secrets, commit it, or regenerate it on updates.
The host `.env`, database and uploaded files are separate from the Docker test data.
The current Docker APP_KEY was deliberately matched to the imported host dataset;
preserve it on subsequent launches. Restore evidence and backups are under ignored
`artifacts/docker-transfer-20261029-restore/`; environment backups there are encrypted
with Windows user DPAPI. See `docs/VALIDATION.md` for the transfer checks.

Persistent volumes: `ytt-test_mysql`, `ytt-test_storage`, `ytt-test_redis`.
Normal `down` preserves them. Do not add `--volumes`, `migrate:fresh`, automatic
seeding, Docker factory resets, or global pruning to routine launch/update/stop
workflows. Treat removal of persistent data as a separate destructive operation.
Old untagged images can remain after rebuilds; they are distinct from campaign
data volumes. The current Compose configuration repeats the shared image build
across services and can produce extra untagged images; that optimization is pending.

### Permanent local QA fixture — reuse it

At the user's explicit request on 2026-10-30, routine local QA must reuse the
single prepared campaign, scene, game session and three existing test accounts.
See [docs/TEST_PLAYGROUND.md](docs/TEST_PLAYGROUND.md) for current IDs, URLs and
the location of the ignored local credentials file. Read it before live-data QA.

Do not register more accounts or create new test campaigns, scenes or game
sessions for each task, browser run or viewport. Sign into the existing accounts
using isolated browser contexts. Reuse and restore the prepared scene's state
after checks. Add only content genuinely needed by the requested feature.
If a test requires separate records, prefer the disposable isolated test database.
Persistent fixture expansion or replacement requires an explicit user request.
Never run the old cleanup/preparation scripts as an ordinary verification step.
Never copy credentials into tracked documentation, source code, logs or memory.

---

# 2. Product vision

We are building a self-hostable, browser-based virtual tabletop for tabletop RPG sessions, initially focused on D&D-style play.

It should sit conceptually between:

- Owlbear Rodeo's simplicity and immediacy;
- Foundry VTT's power;
- a modern game/editor interface;
- a dedicated GM director console.

The project must **not** attempt to become a complete Foundry clone.

Its primary goal is:

> Give the GM an extremely pleasant, visual and fast environment for preparing and running sessions, while giving players the simplest possible interface.

The application should excel at:

- battle maps;
- exploration maps;
- tokens;
- fog of war;
- encounters;
- initiative;
- spatial tools;
- atmosphere;
- GM notes;
- handouts;
- music and ambient sound;
- scene control;
- reusable prefabs;
- scripted cues;
- lightweight automation;
- cinematic presentation.

The application should feel like a **GM's creative workstation and live director console**, not like enterprise software.

---

# 3. Core philosophy

Every major decision should follow these principles.

## 3.1 GM-first

The Game Master is the primary power user.

Optimize preparation and live session control for the GM.

The GM must be able to:

- prepare quickly;
- find things quickly;
- drag and drop assets;
- hide/reveal things instantly;
- trigger prepared events with one action;
- improvise without fighting the application;
- understand the state of the scene at a glance.

Complexity may exist behind the scenes, but the GM workflow should remain understandable.

---

## 3.2 Player-simple

Player UI should be dramatically simpler than GM UI.

Players primarily need:

- the active scene;
- their tokens;
- movement;
- pings;
- measurements;
- visible handouts;
- combat state;
- dice/chat if implemented.

Players should never need to understand the internal editor model.

Avoid exposing unnecessary controls.

---

## 3.3 Interaction quality before feature count

A smaller polished VTT is better than a huge mediocre VTT.

These actions must feel excellent:

- pan;
- zoom;
- token drag;
- token selection;
- multi-selection;
- snapping;
- opening panels;
- switching scenes;
- revealing fog;
- dropping assets;
- resizing and rotating objects;
- triggering cues.

Do not add large systems while basic interaction still feels rough.

---

## 3.4 Vertical slices over horizontal scaffolding

Build usable workflows end-to-end.

Prefer:

> Create scene → add map → add token → player joins → token moves in realtime

over:

> Create ten generic managers, plugin APIs, factories and abstraction layers without a finished user workflow.

Every major phase should result in something that can actually be used.

---

## 3.5 Visual quality is a first-class requirement

"Functional" is not enough.

The product must be attractive, responsive and coherent.

Visual polish is part of acceptance criteria.

Do not postpone all presentation work until the end.

---

# 4. What this project is NOT

Do not turn this project into:

- a Foundry VTT clone;
- D&D Beyond;
- a rules simulator;
- a character builder;
- a monster/spell encyclopedia;
- a video conferencing application;
- a voice chat application;
- a marketplace;
- a social platform;
- an enterprise admin dashboard;
- a generic plugin platform before the core application is mature.

Avoid premature implementation of:

- full D&D 5e automation;
- hundreds of spells;
- automatic rules adjudication;
- character advancement;
- complete item systems;
- plugin marketplace;
- scripting language;
- public module ecosystem;
- video chat;
- voice chat;
- procedural map generation.

These can be reconsidered much later.

---

# 5. Relationship with the existing D&D Story application

There is another separate application used for cinematic scenes, NPC dialogue, visual-novel-style presentation and narrative content.

That application is currently desktop-oriented.

This VTT is web-oriented.

They are **independent applications**.

Do not create architectural coupling between them at this stage.

Do not require one application to run the other.

Do not introduce shared databases or shared deployment requirements merely to support hypothetical integration.

However, avoid decisions that would make future integration unnecessarily difficult.

Potential future integration may use:

- HTTP APIs;
- WebSockets;
- localhost bridge;
- deep links;
- shared export/import formats;
- a small interoperability protocol.

Future examples might include:

- start a Story scene from the VTT;
- return from a Story scene to a particular VTT scene;
- trigger a dialogue from a VTT cue;
- synchronize campaign metadata;
- transfer NPC/portrait references.

This is future work only.

For now:

> Build an excellent standalone VTT.

---

# 6. Target deployment model

The application should be web-first.

Expected deployment options:

### Local

GM runs the application locally.

### Self-hosted

GM deploys it to a personal VPS and players connect through a URL.

Example:

```text
https://dnd.example.com
```

Players join through an invitation link such as:

```text
https://dnd.example.com/join/ABCD1234
```

A native desktop wrapper may eventually be created for the GM using something lightweight such as Tauri.

Do not require players to install desktop software.

---

# 7. Preferred technology stack

Unless there is a strong technical reason to change it, use the following baseline.

## Frontend

- React
- TypeScript
- Vite
- PixiJS for the actual tabletop renderer

Use React for:

- application chrome;
- panels;
- inspector;
- dialogs;
- asset library;
- scene manager;
- encounter manager;
- initiative;
- cue editor;
- settings.

Use PixiJS for:

- maps;
- tokens;
- props;
- grid;
- fog;
- drawings;
- templates;
- particles;
- animated scene objects;
- effects.

Do not render a complex VTT scene as hundreds of normal DOM nodes.

---

# 8. Backend

Preferred backend:

- Laravel 13;
- PHP 8.3+;
- MySQL;
- Redis;
- Laravel Reverb / WebSockets.

The backend is authoritative.

The client must never be considered the canonical source of multiplayer state.

Use queues only where useful.

Avoid unnecessarily distributed architecture.

For normal groups of roughly 4-8 players, the system should remain technically straightforward.

---

# 9. High-level application architecture

```text
Browser
│
├── React Application UI
│
├── PixiJS Scene Renderer
│
├── Local Client State
│
└── Realtime Client
        │
        ▼
Laravel API
│
├── Authentication
├── Authorization
├── Campaign Application Layer
├── Scene Application Layer
├── Asset Layer
├── Realtime Layer
├── Cue / Automation Layer
│
├── Redis
└── MySQL
```

Avoid pushing domain logic deep into controllers or frontend components.

Important behavior should live in explicit application/domain services/actions.

---

# 10. Renderer architecture

The scene renderer should have explicit conceptual layers.

Example:

```text
SceneRenderer

├── BackgroundLayer
├── MapLayer
├── GridLayer
├── DrawingLayer
├── PropLayer
├── TokenLayer
├── TemplateLayer
├── FogLayer
├── EffectLayer
├── GMLayer
└── InteractionLayer
```

Exact implementation may evolve, but layer responsibilities should remain understandable.

Renderer code should not become a single giant component.

---

# 11. Scene coordinate system

Scene objects must use world coordinates independent from viewport dimensions.

Pan/zoom is a camera concern.

Objects should not store positions based on browser pixels.

The renderer should support:

- large maps;
- fractional zoom;
- high-DPI displays;
- scene resizing;
- different player screen sizes.

Scene state and camera state should remain separate.

---

# 12. Core domain concepts

At minimum the architecture should understand these concepts.

## User

Authenticated or temporary participant.

## Campaign

Top-level workspace.

Contains scenes, assets, encounters and sessions.

## Campaign Member

User membership and role.

Initial roles:

- GM;
- Player.

More granular roles may be added later only when useful.

## Scene

Playable visual space.

Contains:

- map/background;
- dimensions;
- grid configuration;
- scene objects;
- fog state;
- audio configuration;
- optional scene metadata.

## Scene Object

Generic positioned object.

Possible types eventually include:

- token;
- prop;
- note marker;
- light;
- effect;
- trigger;
- region;
- door;
- drawing;
- measurement template.

Do not force every scene object into an overly generic schema if doing so makes implementation worse.

Use sensible domain boundaries.

## Asset

Reusable media resource.

## Token

A scene entity representing a character, NPC or creature.

## Encounter

Reusable combat group/configuration.

## Prefab

Reusable collection of configured objects.

## Cue

Prepared GM-triggered sequence of actions.

## Trigger

Automatic condition capable of running actions.

## Session

Optional ordered run-of-show for a particular tabletop session.

---

# 13. Asset library

Asset management is a core workflow, not an afterthought.

Recommended categories:

```text
Maps
Characters
Monsters
NPCs
Props
Effects
Portraits
Backgrounds
Audio
Music
Handouts
Prefabs
```

Requirements:

- drag and drop upload;
- drag directly from library onto scene;
- search;
- tags;
- folders or collections where useful;
- thumbnails;
- recent assets;
- reusable metadata.

Avoid excessive upload dialogs.

The ideal workflow is:

```text
search "Goblin Archer"
→ drag
→ drop on map
→ ready
```

---

# 14. Local asset storage

Initial implementation should work with local/self-hosted file storage.

Example:

```text
storage/
└── campaigns/
    └── campaign-id/
        ├── maps/
        ├── tokens/
        ├── portraits/
        ├── music/
        ├── sounds/
        └── handouts/
```

Keep storage behind a sensible abstraction so S3-compatible storage can be added later.

Potential future adapters:

```text
LocalFilesystemStorage
S3Storage
MinioStorage
```

Do not require external cloud storage for basic usage.

---

# 15. Realtime architecture

Realtime is a fundamental feature.

Do not synchronize the entire scene after every action.

Use snapshots plus incremental events.

Initial connection:

```text
GET scene snapshot
        ↓
hydrate local state
        ↓
subscribe to realtime updates
```

Then send small commands/events.

Examples:

```text
token.move
token.update
token.create
token.delete

object.reveal
object.hide

fog.patch

scene.activate

initiative.update

cue.started
cue.step
cue.completed
```

Example token movement payload conceptually:

```json
{
  "tokenId": 127,
  "x": 1284.5,
  "y": 742.2,
  "rotation": 90
}
```

Do not send the whole scene JSON for every drag.

---

# 16. Server authority

The server is authoritative.

Example:

```text
Player requests token movement
        ↓
Server checks membership
        ↓
Server checks token ownership
        ↓
Server validates operation
        ↓
Server persists authoritative state
        ↓
Server broadcasts accepted result
```

Do not trust arbitrary client mutations.

---

# 17. Secret information must be filtered server-side

Never send secret GM information to players merely with a client-side `hidden: true`.

Bad:

```json
{
  "name": "Ancient Red Dragon",
  "hidden": true
}
```

The player should not receive that entity at all unless they are authorized to know about it.

Use a server-side visibility/permission resolver.

Conceptually:

```text
Full GM Scene
      ↓
Visibility Resolver
      ↓
Player-specific Scene Snapshot
```

GM may receive:

```text
Map
Players
Goblin
Dragon
Secret Door
Trap
GM Note
```

Player may receive:

```text
Map
Players
Goblin
```

This requirement applies to both:

- initial scene snapshots;
- realtime broadcasts.

---

# 18. Permissions

Initial permission model should remain understandable.

Important concepts:

- GM owns and controls the campaign;
- players may control assigned tokens;
- GM can control everything;
- objects can be GM-only;
- objects can be hidden;
- some objects may be globally visible but non-interactive;
- handouts may be revealed selectively.

Avoid implementing a massive ACL system prematurely.

---

# 19. P0 — Working VTT

P0 should result in a genuinely usable virtual tabletop.

Do not begin major P1 work until P0 interaction quality is good.

Required P0 features:

## Campaigns

- create campaign;
- open campaign;
- invite/join player.

## Scenes

- create scene;
- rename scene;
- duplicate scene if practical;
- activate scene;
- save scene state.

## Maps

Support common image formats such as:

- PNG;
- JPEG;
- WebP.

GM can:

- upload map;
- place map;
- resize map;
- position map.

## Grid

Support initially:

- square grid;
- grid size;
- offset;
- visibility;
- snap on/off.

Grid calibration should be pleasant.

## Tokens

GM can:

- create token;
- choose image;
- move;
- resize;
- rotate;
- duplicate;
- delete;
- lock;
- hide/reveal;
- assign to player.

Player can move owned token.

## Interaction

Must support:

- click selection;
- drag selection if appropriate;
- multi-select;
- pan;
- zoom;
- keyboard delete;
- sensible keyboard shortcuts;
- context menu or action menu.

## Realtime multiplayer

All connected participants should see accepted changes rapidly.

## Fog of war

P0 uses manual fog.

GM can:

- cover scene;
- reveal with brush;
- hide again;
- use useful brush sizes;
- reveal rectangular/polygonal areas if practical.

Do not implement dynamic LOS in P0.

## Measurement

Support:

- ruler;
- circle;
- cone;
- rectangle.

## Ping

Players and GM can ping locations.

## Token state

Lightweight fields:

- name;
- current HP;
- max HP;
- AC;
- optional speed;
- conditions.

## Initiative tracker

Support:

- add combatants;
- initiative value;
- order;
- next turn;
- previous turn;
- round counter;
- remove participant.

## Persistence

Reloading must not lose prepared scene state.

---

# 20. P0 UX acceptance criteria

P0 is not complete merely because all buttons exist.

The following must feel good:

### Token dragging

No visible stuttering under normal conditions.

### Pan and zoom

Must feel smooth and predictable.

### Snap

Must not surprise the user.

### Selection

Selected state must be visually obvious without being ugly.

### Realtime

Remote token movement should look intentional rather than teleporting between stale states where practical.

### Scene activation

Players should transition clearly to the active scene.

### Errors

Connection or permission errors should be understandable.

---

# 21. P1 — GM Experience

After the VTT foundation is strong, focus on making it an excellent GM tool.

## Asset library

Full workflow described earlier.

## GM-only layer

Allow GM-only objects such as:

- notes;
- secret markers;
- traps;
- encounter markers;
- trigger markers;
- hidden NPCs;
- secret doors;
- reminders.

Players must never receive restricted information.

Example:

```text
📌 Note
⚠ Encounter
💬 Dialogue
🎵 Audio
🚪 Transition
👁 Reveal
⚙ Trigger
```

GM should be able to place these naturally on a scene.

---

# 22. GM notes

Notes should be contextual.

Example:

```text
Secret Basement

DC 15 Perception

If discovered:
- reveal basement entrance
- play stone movement sound
- activate Basement Reveal cue
```

Clicking a GM note should not disrupt the scene unnecessarily.

---

# 23. Handouts

Support:

- images;
- documents where practical;
- textual notes later.

GM action:

```text
Show to Players
```

Players receive a polished overlay/modal.

Handouts should support:

- zoom;
- pan where relevant;
- close;
- optional persistence in discovered handouts.

Selective reveal may be added.

---

# 24. Audio

Support:

- music;
- ambient loops;
- sound effects.

GM should be able to:

- play;
- stop;
- pause;
- fade;
- change volume;
- loop;
- trigger sound from cue.

Avoid audio controls dominating the interface.

---

# 25. Prefabs

Prefabs are important.

A prefab is a reusable configured object or collection of objects.

Examples:

### Campfire

```text
Campfire sprite
+ warm light later
+ fire particles later
+ campfire ambient sound
```

### Magic Portal

```text
Portal animation
+ particles
+ sound
+ optional trigger
```

### Door

```text
Door sprite
+ interaction metadata
```

### Tavern Table

Multiple props arranged together.

Users should be able to create a useful setup once and reuse it.

---

# 26. Encounters

Encounters should also be reusable.

Example:

```text
Goblin Patrol

2 × Goblin
1 × Goblin Archer
1 × Goblin Boss
```

Dragging or spawning an encounter should be able to create the configured token group.

Where practical, combatants can be added to initiative automatically.

Do not turn encounters into a giant rules engine.

---

# 27. P2 — Director System

P2 is where the project should become meaningfully different from generic VTTs.

The application should evolve toward a **GM Director Console**.

---

# 28. Cue system

Cues are first-class domain objects.

A cue represents a prepared sequence of actions.

Example:

```text
GOBLIN AMBUSH

Reveal:
- Goblin 1
- Goblin 2
- Goblin 3

Audio:
- ambush_stinger.ogg

Effect:
- medium camera shake

Message:
- "Roll initiative!"

Encounter:
- Goblin Patrol
```

GM should be able to run it through a clear action:

```text
▶ GOBLIN AMBUSH
```

One action may trigger multiple coordinated events.

---

# 29. Cue action types

Potential actions include:

```text
Reveal Object
Hide Object
Move Object
Spawn Prefab
Spawn Encounter
Play Sound
Start Music
Stop Music
Fade Audio
Show Handout
Show Message
Start Combat
Update Initiative
Apply Effect
Camera Focus
Camera Pan
Camera Zoom
Camera Shake
Activate Scene
Wait
```

Implement incrementally.

Do not build every imaginable action before the cue system itself is pleasant.

---

# 30. Trigger system

Triggers may automatically execute cue-like actions.

Potential events:

```text
OnEnter
OnExit
OnClick
OnReveal
OnCombatStart
OnRoundStart
OnTurnStart
OnTokenDeath
OnSceneActivated
```

Example:

```text
WHEN
Player enters Graveyard

DO
Play wind.mp3
Enable fog effect
Reveal Ghost
Wait 2 seconds
Show message
```

The preferred user experience is visual.

Avoid requiring normal users to write JavaScript macros.

---

# 31. Visual automation builder

Prefer:

```text
WHEN
[ Player enters ] [ Graveyard ]

DO
[ Play Sound ] [ wind.mp3 ]
[ Reveal ] [ Ghost ]
[ Wait ] [ 2 seconds ]
[ Show Handout ] [ Warning ]
```

over:

```javascript
game.scene.actors...
```

A scripting API may exist much later for advanced users, but visual composition is the default.

---

# 32. Camera Director

A powerful future feature.

GM can optionally control the players' viewport for cinematic moments.

Actions may include:

```text
Focus
Pan
Zoom
Shake
Fade
Blackout
Release Camera
```

Example sequence:

```text
Focus → Altar
Zoom → 135%
Wait → 600 ms
Reveal → Demon
Shake → Medium
Play → Impact Sound
Release Camera
```

Players must not permanently lose independent camera control.

Cinematic camera control should be temporary and explicit.

---

# 33. P3 — Immersion

Once core workflows and Director Mode are strong, improve atmosphere.

Potential systems:

## Animated maps

Support performant animated backgrounds where practical.

Likely formats:

- WebM;
- animated WebP;
- other browser-friendly formats.

## Animated tokens and props

Support:

- WebM;
- animated WebP;
- sprite sheets where useful.

## Weather

Reusable visual effects:

- rain;
- snow;
- ash;
- fog;
- falling leaves;
- embers.

## Screen effects

Potential effects:

- flash;
- shake;
- vignette;
- blackout;
- frost;
- subtle chromatic distortion;
- blood vignette.

Use tasteful defaults.

Do not make the application look like a cheap streaming overlay.

## Ambient zones

Example:

Walking near a waterfall increases waterfall ambience.

Possible spatial audio zones can be introduced after basic audio is stable.

---

# 34. Dynamic vision and lighting

Dynamic LOS should NOT be implemented before manual fog works well.

Future system may include:

- walls;
- doors;
- token vision;
- light sources;
- darkness;
- darkvision;
- individual fog;
- line of sight.

This is considered a significant subsystem.

Treat it as such.

Do not hack dynamic vision into the codebase with ad-hoc raycasts scattered throughout renderer components.

---

# 35. Session Mode

Session Mode should turn prepared content into a live run-of-show.

Example:

```text
SESSION 12 — THE WITNESS

1. Arrival
   Scene: City Gate

2. Tavern
   Scene: Tavern
   NPC: Mira

3. Investigation
   Handout: Ancient Letter

4. Sewers
   Scene: Sewers

5. Ambush
   Encounter: Cultists

6. The Witness
   Cue: Witness Appears

7. Escape
   Scene: Burning Sewers
```

During play:

```text
← Previous        4 / 7        Next →
```

Players do not see the private session structure.

This feature should help the GM remember prepared beats without forcing them into a rigid linear story.

The GM must always remain free to jump to any scene or cue.

---

# 36. Preloading

Scene transitions should feel fast.

Implement scene/asset preloading once the basic multiplayer system is stable.

Potential GM status:

```text
Scene Ready

GM          ✓
Player 1    ✓
Player 2    ✓
Player 3    ✓
```

Preloaded content may include:

- map;
- token images;
- handout images;
- audio;
- effects.

Do not activate a new scene merely because it was preloaded.

---

# 37. Character information

Keep character data intentionally lightweight initially.

Example:

```text
Kern

HP       34 / 41
AC       18
Speed    30

STR +4
DEX +2
CON +3
INT +0
WIS +1
CHA -1
```

This is enough for a VTT.

Do not build a complete D&D character builder unless explicitly requested later.

---

# 38. Dice

Initial dice functionality may support expressions such as:

```text
/d20
/d20+6
/2d6+4
/4d8
```

Roll visibility:

```text
Public
GM Only
Whisper
```

Example result:

```text
Kern
Longsword

17 + 6 = 23
```

3D dice may be added later as presentation polish.

Do not prioritize 3D dice over core tabletop UX.

---

# 39. Import and export

The system should eventually support portable formats.

Start with our own stable export format.

Potential basic token JSON:

```json
{
  "name": "Kern",
  "hp": 38,
  "maxHp": 42,
  "ac": 17,
  "speed": 30
}
```

Possible future adapters:

- custom JSON;
- Foundry;
- Roll20;
- D&D Beyond where technically and legally appropriate.

The core application should remain system-agnostic.

---

# 40. Visual direction

This section is mandatory.

The application must be visually polished.

Do NOT produce a generic Laravel/React admin dashboard.

Do NOT use a default component library appearance without substantial design work.

The desired feeling is:

> premium creative tool + game editor + cinematic GM workstation

not:

> SaaS CRM

---

# 41. UI visual character

Preferred direction:

- dark-first;
- restrained;
- cinematic;
- modern;
- slightly atmospheric;
- high contrast where necessary;
- comfortable for multi-hour sessions;
- dense enough for professional use without becoming cluttered.

Avoid excessive medieval decoration.

Avoid covering the interface in:

- parchment textures;
- ornamental borders;
- fantasy fonts;
- fake leather;
- unnecessary gold trim.

Fantasy content belongs primarily inside the campaign, not permanently baked into every application panel.

The application shell itself should feel modern.

---

# 42. Typography

Use readable modern typography for UI.

Prioritize:

- clarity;
- hierarchy;
- compact information density;
- readability at small sizes.

Decorative fonts may be used very sparingly for presentation content, never for core controls.

---

# 43. Motion

Motion should communicate state.

Use subtle animations for:

- panel transitions;
- selection;
- hover;
- context menus;
- token movement;
- scene transitions;
- modals;
- notifications;
- cue execution.

Typical UI animation should feel quick.

Avoid slow ornamental animation that delays interaction.

Respect reduced-motion preferences where practical.

---

# 44. Layout

GM workspace should roughly support:

```text
┌─────────────────────────────────────────────────────────────┐
│ Campaign / Scene       Players       Tools        ▶ PLAY   │
├──────────┬───────────────────────────────────┬──────────────┤
│          │                                   │              │
│ Scenes   │                                   │  Inspector   │
│          │                                   │              │
│ Assets   │              MAP                  │  Properties  │
│          │                                   │              │
│ NPCs     │                                   │  Actions     │
│          │                                   │              │
│ Cues     │                                   │              │
│          │                                   │              │
├──────────┴───────────────────────────────────┴──────────────┤
│ Tokens │ Props │ Monsters │ Effects │ Audio │ Handouts     │
└─────────────────────────────────────────────────────────────┘
```

This is conceptual, not a rigid pixel specification.

Panels should eventually support useful resizing.

Docking may be considered later.

---

# 45. Player layout

Player interface should feel closer to:

```text
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│                                                             │
│                           MAP                               │
│                                                             │
│                      Player Token                           │
│                                                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

Minimal overlays only when needed.

---

# 46. Contextual controls

Prefer contextual actions near selected objects over permanent walls of buttons.

Example:

Select token:

```text
Move
Rotate
Hide
Lock
Duplicate
More…
```

Detailed editing appears in Inspector.

Do not place every possible command in the main toolbar.

---

# 47. Drag and drop

Drag and drop is a major interaction language of the application.

Support it wherever natural:

- asset → scene;
- prefab → scene;
- encounter → scene;
- combatant → initiative;
- asset → token image;
- audio → cue;
- object → group.

Every drag action needs clear feedback.

---

# 48. Command palette

A future command palette is encouraged.

Potential shortcut:

```text
Ctrl/Cmd + K
```

Examples:

```text
Activate Tavern Scene
Spawn Goblin
Run Goblin Ambush
Show Ancient Letter
Start Combat
Play Tavern Ambience
```

This can become extremely useful for experienced GMs.

---

# 49. Keyboard shortcuts

Provide efficient shortcuts over time.

Possible examples:

```text
Space + drag    Pan
Delete          Delete selected
Ctrl/Cmd + D    Duplicate
Ctrl/Cmd + Z    Undo
Ctrl/Cmd + Shift + Z  Redo
F               Fog tool
R               Ruler
T               Token tool
P               Ping
```

Do not create conflicting or surprising bindings.

Provide a discoverable shortcut reference.

---

# 50. Undo / redo

Important editor actions should eventually support undo/redo.

Particularly:

- movement;
- deletion;
- resize;
- rotation;
- fog changes;
- object placement;
- grouping.

Architecture should not make undo impossible.

Do not implement an enormous event sourcing architecture solely for undo unless genuinely justified.

---

# 51. Responsive behavior

Primary GM experience targets desktop/laptop.

Player experience should work reasonably on:

- desktop;
- laptop;
- tablet.

Mobile support can be limited but should not catastrophically break.

Do not compromise the desktop GM experience merely to force every editor function onto a phone.

---

# 52. Performance

Performance is a feature.

Avoid:

- unnecessary React re-renders during token movement;
- storing rapidly-changing renderer state in inappropriate global React state;
- giant uncompressed payloads;
- reloading all scene assets after minor changes;
- excessive websocket broadcasts;
- rendering invisible objects unnecessarily.

Measure actual performance when optimizing.

Do not prematurely micro-optimize ordinary CRUD code.

---

# 53. Large scene considerations

The design should tolerate:

- large map images;
- many props;
- dozens of tokens;
- effects;
- fog.

Possible optimization strategies later:

- texture atlases;
- object culling;
- asset caching;
- lazy loading;
- viewport-aware rendering;
- spatial indexes;
- lower-resolution previews.

Add complexity only when justified.

---

# 54. Offline resilience

The VTT is multiplayer and therefore primarily online, but normal transient disconnections should not destroy work.

Support:

- reconnect;
- visible connection state;
- scene resynchronization;
- safe retry of appropriate actions.

GM preparation should autosave regularly.

Never silently discard prepared changes.

---

# 55. Data migrations and compatibility

Database schema will evolve.

Use normal migrations.

Avoid destructive migrations without explicit need.

If scene serialization formats evolve, provide migration paths.

Do not leave old scene JSON formats silently incompatible.

---

# 56. Testing philosophy

Tests should protect meaningful behavior.

Required test areas include:

- permissions;
- campaign membership;
- player ownership;
- hidden object filtering;
- realtime authorization;
- scene persistence;
- cue execution;
- invite/join flows;
- asset authorization.

Frontend tests should cover critical interaction/state behavior where valuable.

Do not produce hundreds of meaningless snapshot tests.

---

# 57. Security

At minimum:

- validate uploaded files;
- protect private campaign assets;
- validate scene mutations;
- validate campaign membership;
- rate-limit sensitive/public endpoints;
- prevent arbitrary player object control;
- never expose GM secrets through APIs;
- sanitize any user-authored rich text;
- do not trust filenames or MIME types blindly.

Self-hosted software is still software exposed to browsers and often the public internet.

---

# 58. Accessibility

Do not completely ignore accessibility because this is a game tool.

At minimum:

- keyboard-accessible dialogs;
- visible focus states;
- readable contrast;
- proper labels;
- usable forms;
- reduced-motion consideration.

The canvas itself may require specialized accessibility compromises.

---

# 59. Error handling

Do not present raw stack traces to normal users.

Use understandable errors.

Examples:

```text
You no longer have permission to control this token.
```

```text
Connection lost. Trying to reconnect…
```

```text
This scene could not be loaded.
```

Development mode can expose detailed diagnostics separately.

---

# 60. Logging and diagnostics

Provide enough diagnostics to understand:

- WebSocket failures;
- scene synchronization errors;
- asset failures;
- cue failures;
- authorization rejection.

Avoid noisy production logs for routine actions such as every mouse movement.

---

# 61. P4 — optional advanced systems

Only consider these after the main product is excellent.

Possible P4 areas:

- richer D&D automation;
- detailed character sheets;
- compendiums;
- import adapters;
- advanced macros;
- plugin API;
- dynamic lighting improvements;
- advanced walls;
- richer spatial triggers.

Every P4 feature must justify the added complexity.

---

# 62. Features explicitly deferred

Do not implement unless explicitly requested:

```text
Marketplace
Public plugin ecosystem
Video chat
Voice chat
Full D&D Beyond replacement
Character builder
Complete spell database
Complete monster database
Automatic leveling
Complex rules engine
Procedural map generation
Built-in streaming platform
Public social profiles
```

---

# 63. Development phases

Use this order as a strategic guideline.

```text
P0 FOUNDATION

Project shell
↓
Canvas renderer
↓
Map
↓
Grid
↓
Tokens
↓
Realtime multiplayer
↓
Permissions
↓
Manual fog
↓
Measurements
↓
Initiative
↓
Persistence

WORKING VTT
```

Then:

```text
P1 GM EXPERIENCE

Asset library
↓
GM notes/layer
↓
Handouts
↓
Audio
↓
Encounters
↓
Prefabs
↓
Better editor UX

GOOD VTT
```

Then:

```text
P2 DIRECTOR

Cues
↓
Triggers
↓
Visual automation
↓
Camera director
↓
Session mode
↓
Preloading

DISTINCTIVE VTT
```

Then:

```text
P3 IMMERSION

Animated maps
↓
Animated props
↓
Weather
↓
Particles
↓
Advanced effects
↓
Walls
↓
Lighting
↓
Dynamic vision

PREMIUM FEEL
```

Then, only where justified:

```text
P4 ADVANCED

Rules automation
Character sheets
Importers
Macros
Plugins
```

---

# 64. Definition of Done for a feature

A feature is not finished when:

- backend endpoint exists;
- a button exists;
- TypeScript compiles.

A user-facing feature should normally satisfy:

1. core behavior works;
2. permissions are correct;
3. state survives reload where appropriate;
4. multiplayer behavior is correct where applicable;
5. loading state exists;
6. failure state exists;
7. UI matches product design quality;
8. interaction is pleasant;
9. obvious edge cases are handled;
10. relevant tests exist;
11. documentation is updated if behavior changed materially.

---

# 65. Agent working rules

AI agents must work deliberately.

Before a significant implementation:

1. inspect the existing architecture;
2. identify affected systems;
3. avoid duplicating existing functionality;
4. determine the smallest coherent vertical slice;
5. implement;
6. test;
7. manually validate the real workflow where possible;
8. review visual quality;
9. document relevant changes.

Do not blindly generate large amounts of infrastructure.

---

# 66. Avoid architecture churn

Do not repeatedly rewrite the stack because another library appears slightly more elegant.

A dependency change should have a clear benefit.

Do not introduce a framework solely because it is fashionable.

Prefer boring reliable backend infrastructure and deliberate frontend/renderer engineering.

---

# 67. Do not overabstract early

Avoid creating abstractions such as:

```text
GenericEntityManagerFactory
UniversalRulesEngine
PluginRuntime
DynamicEverythingProvider
```

without actual product requirements.

Start with understandable domain code.

Extract abstractions after real duplication or extension needs appear.

---

# 68. No giant components

Avoid:

- 2,000-line React components;
- giant Pixi scene files;
- giant Laravel services;
- single stores containing the entire application.

Split by actual responsibility.

Do not split files merely to satisfy arbitrary line counts.

---

# 69. Keep rendering and domain state distinct

Important distinction:

### Domain state

```text
Token exists at X/Y
Token HP = 20
Token hidden = false
```

### Presentation state

```text
Token currently tweening
Token hovered
Selection glow visible
Context menu open
```

Do not persist transient presentation state to the backend.

---

# 70. Multiplayer movement

Token dragging requires special care.

Avoid writing to the database for every raw pointer movement.

Use an efficient model.

For example:

```text
drag starts
↓
client sends throttled preview movement
↓
other clients render preview
↓
drag ends
↓
final authoritative position persists
```

Exact protocol may evolve.

Prioritize:

- responsiveness for the local player;
- useful remote feedback;
- authoritative final state.

---

# 71. Optimistic UI

Optimistic UI is encouraged where appropriate.

However:

- never let optimistic state bypass permissions;
- reconcile rejected changes;
- make conflicts understandable.

---

# 72. Styling implementation

Use a consistent design system.

Define reusable concepts for:

- spacing;
- typography;
- surfaces;
- borders;
- radii;
- shadows;
- focus;
- hover;
- active state;
- dangerous actions;
- selection state;
- GM-only state.

Do not allow every feature to invent its own visual language.

---

# 73. Component libraries

A component library may be used for foundations.

However:

> The final interface must not look like an untouched component library demo.

Customize it to fit the VTT design system.

The tabletop itself must remain visually dominant.

---

# 74. Empty states

Empty states matter.

Bad:

```text
No assets.
```

Better:

```text
No maps yet.

Drop an image here
or upload your first battle map.
```

Guide users toward the next useful action.

---

# 75. Tooltips

Use tooltips for icon-heavy GM controls.

Do not require players to guess what an icon means.

For shortcuts, show them in tooltips where appropriate.

Example:

```text
Fog of War
F
```

---

# 76. Dangerous actions

Deletion of major objects should be recoverable or confirmed appropriately.

Do not show confirmation dialogs for every tiny action.

Use:

- undo where available;
- soft deletion where beneficial;
- confirmation for large destructive operations.

---

# 77. Scene browser

Scene management should eventually feel visual.

Prefer cards/thumbnails where useful rather than an undifferentiated database table.

Potential scene states:

```text
Active
Prepared
Archived
```

GM should be able to activate another scene quickly.

---

# 78. Inspector

The Inspector is the main place for detailed object editing.

Possible token sections:

```text
Identity
Position
Appearance
Gameplay
Visibility
Ownership
Automation
Advanced
```

Do not display all options expanded simultaneously.

Use progressive disclosure.

---

# 79. Selection and grouping

Eventually support:

- multiple selection;
- move group;
- duplicate group;
- delete group;
- group into prefab.

This greatly improves preparation speed.

---

# 80. Layers panel

A full Photoshop-style layer system may be excessive initially.

However, the system should understand object ordering.

Provide enough tools for:

- send forward;
- send backward;
- bring to front;
- send to back.

More advanced layer management can come later.

---

# 81. Fog philosophy

Manual fog is the initial default because it is:

- reliable;
- understandable;
- easy to control;
- system-agnostic.

Dynamic vision is an enhancement, not a prerequisite for a good VTT.

The application should remain fully usable even for GMs who never configure walls.

---

# 82. Rules-system philosophy

Core VTT architecture should remain mostly RPG-system agnostic.

D&D-specific conveniences are welcome where they do not infect the entire architecture.

Examples of reasonable generic fields:

```text
HP
Armor/Defense
Speed
Conditions
Initiative
```

Avoid hard-coding every domain model around one edition of one RPG.

---

# 83. Beautiful defaults

Whenever the user creates something new, default values should produce a good result.

Examples:

- sensible token size;
- readable labels;
- pleasant grid;
- subtle selection outline;
- usable panel sizing;
- reasonable animation duration;
- normalized audio volume.

Users should not need to configure ten properties before an object looks acceptable.

---

# 84. Progressive complexity

Beginner workflow:

```text
Create Scene
→ Drop Map
→ Drop Tokens
→ Play
```

Advanced workflow:

```text
Create Scene
→ Configure assets
→ Add hidden objects
→ Create encounters
→ Add cues
→ Configure triggers
→ Add effects
→ Preload
→ Run session
```

Both should coexist.

Do not make simple play require advanced configuration.

---

# 85. First-run experience

Eventually provide a concise onboarding flow.

Avoid long mandatory tutorials.

Potential sample campaign can demonstrate:

- map;
- token;
- fog;
- handout;
- encounter;
- cue.

Let users learn by interacting.

---

# 86. Product quality bar

The expected quality is closer to a real creative application than an internal prototype.

Ask during implementation:

- Does this look intentional?
- Does this interaction feel good?
- Is this faster than doing it manually?
- Would a GM enjoy using it for four hours?
- Is the scene still visually dominant?
- Is the interface helping or distracting?

If the answer is no, polish before endlessly adding new features.

---

# 87. Initial vertical slice

The first major milestone should prove the complete product architecture.

Required workflow:

```text
GM creates campaign
        ↓
GM creates scene
        ↓
GM uploads map
        ↓
GM configures grid
        ↓
GM creates token
        ↓
GM creates invite
        ↓
Player opens browser link
        ↓
Player joins campaign
        ↓
GM assigns token
        ↓
Player moves token
        ↓
GM sees movement in realtime
        ↓
State survives refresh
```

This should work reliably before building large secondary systems.

---

# 88. Suggested second vertical slice

```text
GM prepares scene
        ↓
GM places hidden monsters
        ↓
GM covers map with fog
        ↓
Players join
        ↓
GM reveals corridor
        ↓
Players move
        ↓
GM reveals monsters
        ↓
GM starts encounter
        ↓
Initiative tracker begins
```

This proves the application is actually useful for a real session.

---

# 89. Suggested third vertical slice

```text
GM creates Goblin Ambush cue
        ↓
Cue contains:
    reveal monsters
    play sound
    show message
    start encounter
        ↓
GM presses one button
        ↓
All players receive coordinated result
```

This proves the Director concept.

---

# 90. Long-term product identity

The product should ultimately feel like three layers working together:

```text
                 GM DIRECTOR
                      │
       ┌──────────────┼──────────────┐
       │              │              │
    TABLETOP       PREPARATION     DIRECTOR
       │              │              │
      maps           assets          cues
     tokens         encounters      triggers
      fog            prefabs         camera
     combat          handouts        effects
      AoE             notes          audio
       │              │              │
       └──────────────┼──────────────┘
                      │
                   PLAYERS
```

The key differentiator is not having more checkboxes than Foundry.

The key differentiator is:

> Making preparation and live direction exceptionally smooth.

---

# 91. Final product rule

When choosing between:

### Option A

A technically impressive feature used twice per campaign.

### Option B

A small improvement that makes an action performed fifty times per session faster and nicer.

Prefer Option B.

When choosing between:

### Option A

Five mediocre new features.

### Option B

One excellent feature that meaningfully improves the session.

Prefer Option B.

When choosing between:

### Option A

A generic implementation because it was quicker for the agent.

### Option B

An implementation that fits the actual product.

Prefer Option B.

---

# 92. Current strategic priority

The current priority is:

> Build the best possible foundation for the standalone web VTT.

Do not spend implementation time integrating with the separate desktop D&D Story application yet.

Keep interoperability possible, but deferred.

The immediate product must succeed on its own.

---

# 93. Instruction to future agents

Before starting work, read this entire document.

Do not interpret "VTT" as a request to reproduce every Foundry feature.

Do not optimize for raw feature count.

Do not turn the project into an admin panel.

Do not sacrifice visual quality.

Do not hide poor UX behind technical completeness.

Do not prematurely build extensibility for imaginary users.

Build the workflows the GM actually uses.

Make them fast.

Make them reliable.

Make them beautiful.

And preserve the central idea:

> This is not merely a map with tokens.  
> It is the Game Master's tabletop, preparation workspace and live director console.
