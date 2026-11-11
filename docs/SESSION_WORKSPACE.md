# Session workspace · map-first foundation

Session (`?mode=session`, also the campaign scene's play entry) opens with the map,
session/scene and connection state, essential tools, and a compact Combat entry.
The plan, Combat Console and other runtime panels open explicitly as overlays.
Preparation and Library keep their existing authoring workspaces.

Selection opens a compact Token/Character/NPC runtime context: projected HP/max HP,
AC, conditions, Damage/Heal and existing actions with canvas targeting. Details
add checks, lifecycle controls and visibility/movement toggles.
Character/NPC authoring is not part of this runtime flow. Props, notes and regions
also start with a compact identity and an explicit Inspector entry.

`selection → compact context → details → optional Pin`

- Closing details returns to compact context. Closing context hides it until a new
  selection; “Показать контекст выбора” reopens it without changing selection.
- Floating details collapse on a new selection. Pinned context follows selection
  and keeps its edge workspace open, including an empty selection hint.
- Pin anchors the surface to the right edge. It remains an overlay: neither
  opening panels nor Pin changes canvas bounds, zoom or camera center.
- Pin/expanded/selection presentation is local to the current view and resets on
  reload. Runtime state continues to hydrate from the existing snapshot/realtime
  flow. No gameplay persistence or authorization contract changed.
- Transitions affect surfaces only and respect reduced motion.

Director/Cue workflows and preparation editors keep their existing surfaces.

## RPG runtime selection

The screen-space card stays anchored through pan/zoom. It shows a portrait,
health meter, AC, active conditions and up to three prepared actions directly.
More reveals the remaining actions and richer runtime controls, never authoring.
Damage/Heal use inline amount presets and confirmation; Condition uses a searchable
inline picker (public, until removed). Existing condition chips remove or change
visibility through the same authoritative commands.

A tiny token-local strip offers context access and GM visibility. It stays outside
the token hit area and disappears during movement preview or ability targeting.
The left tool rail and Combat entry remain unchanged by this pass.

## Initiative and encounter workspace

Active combat adds a horizontal portrait timeline for GM and Players. It follows
the existing viewer-filtered combat/token snapshot and incremental events; hidden
turns remain anonymous (“Ход ГМ”), and unavailable HP stays unavailable. Portraits
show initiative, permitted HP, public/authorized conditions and lifecycle state.
Gold marks the current turn on the timeline and the map; blue marks local selection.
Portrait click selects and focuses the token without advancing the turn. On narrow
screens the rail scrolls horizontally and recenters on turn changes and resizing.

The compact Combat entry opens a floating encounter workspace in Session mode:
initiative/reordering, round and next/previous turn, add/remove/current combatant,
manual resolution queue and finish. Combatant identity returns to the existing
Runtime Context Card for actions, HP and conditions. This surface has no Pin mode
and never resizes the map. Other workspace modes retain their existing Console.
The light sheet keeps turn navigation and the resolution queue visible. “Инициатива ·
участники” reveals the order and its editing controls; (…) offers add, sort and finish.
Players get the read-only timeline rather than a second combat panel. No combat
rules, commands, persistence or reconnect contracts changed.

Prepared scene encounters now have a separate optional **Столкновения** entry
and an action in **Сессия** (the compact-screen entry).
Its compact list/details supports confirmed launch with selected heroes, reserve
group/individual activation and independent GM-hidden controls. It uses the same
floating dock without Pin, keeps the map/camera in place, and routes initiative
and turn management to the existing Combat Workspace. Preparation stays in Prepare.
Runtime links, retries and completion follow [ENCOUNTER-02](SCENE_PREPARATION.md#encounter-02--prepared-composition-into-live-combat).

Deferred: encounter authoring in Session, Director/Cue integration, Fog/LOS/Lighting
redesign and additional combat/rules mechanics. HP for other players' and NPC tokens continues
to follow the existing server visibility policy.

## Add during Session

`Добавить → Character / NPC / Prop / Container / Interaction → search → choose → click on map`

The compact floating picker replaces Creation Hub only in Session. It uses the
existing global Character/NPC and asset libraries, without authoring controls. Its
EntityPicker is shared with Preparation; Props also expose existing Object Presets.
Already represented campaign Characters are disabled; other library Characters
and NPCs follow the existing copy/link semantics. Character placement ends after
one click; NPCs and Props repeat until Esc or the placement bar's close button.
Esc cancels without creating anything; failed commands keep placement available.
Space-drag pans and Enter places at the current view center.

The Pixi ghost uses snapped world coordinates, the intended runtime size and the
portrait/image (or an initial when absent). Selection and Context UI use the normal
runtime entities immediately. Picker and placement never resize or focus the map
camera. Existing authoritative mutations, private asset access, incremental events
and snapshot/reconnect persistence remain in use.

Container and Interaction choose a Prop image and create an ordinary scene Prop:
Container adds an empty closed loot container; Interaction adds an enabled
«Осмотреть» action with no check/effect. Existing Context → Inspector controls
configure contents and actions. Both presets commit in the existing scene
transaction and use its permissions, idempotency and viewer-filtered events.

Deferred: Recent/Favorites, Handout map placement (current Handouts are shown to
recipients), configured interaction/container templates and further authoring.

## Session plan and quick runtime controls

`План сессии` opens a compact floating run-of-show: session selection/status,
current/next step, direct step navigation and existing linked actions. Navigation
changes plan focus only; scene activation, Handout delivery, Cue start and linked
encounter placement remain explicit authoritative actions. GM notes retain their
existing queued autosave and flush before closing or switching surfaces. Completing
a session keeps the map-first workspace open.

`Сессия` beside the plan opens current scene/live state and quick access to prepared
scene activation, Handouts, players/connection, existing audio and live Cue controls.
Scene activation flushes pending changes and preserves Session mode on navigation.
The menu closes on outside click, Escape or its close button. These floating
surfaces do not resize the canvas or change the camera, including with initiative
visible. Combat keeps its own entry; Add and Character/NPC context keep their flows.
Quick Check remains in token Context → Details because it requires an acting token.

Preparation retains plan creation, structure editing/deletion, scene setup,
automatic-preload configuration, manual asset preloading and trigger authoring.
Session shows existing preload readiness under disclosure and continues configured
automatic preloading. Linked Cue controls use live mode without an authoring editor.

Deferred: Director/Cue rewrite, audio redesign, Map Editor, Fog/LOS/Lighting,
new authoring layers and new session/rules mechanics.

## Session Log · Live Feed

Session has a GM-only compact «Журнал» entry. It starts closed; a new significant
event briefly shows a one-line recent activity card and an unread count. Opening
the floating Live Feed clears the count. Escape, outside click and Close dismiss
it. This surface never changes canvas bounds or camera state. Rows show readable
outcomes; a click reveals existing roll/result details. Dates, combat/outside-combat
filters and cursor-based older pages keep long histories usable.

The existing `combat_events` journal now also has scene scope and a nullable
combat reference. Existing combat history is backfilled to its owning scene;
new out-of-combat results use the same journal inside their authoritative command
transactions. No alternate rules or outcome calculation was added. Names are
captured on new records; older records retain the existing token-name fallback.
The feed spans this scene's combats and runtime activity, not a campaign-wide
history page. Old out-of-combat receipts are not retrospectively reconstructed.

Covered: resolved abilities (attacks, applied damage/healing, checks and target
saves in details), GM checks/saves and resolved object interaction checks,
HP/condition corrections, applied/removed/immune
conditions, concentration and spell-effect endings, turn/round/combat start/end,
turn-budget overrides, manual resolutions/notes, lifecycle outcomes, confirmed
short/long rests, rest dice/completion and stabilization. Only meaningful recorded
types are queried; movement, selection, camera and menu activity are excluded.

The read endpoint authorizes scene update (GM) before returning any private data.
Player UI and broadcast payloads are unchanged; a Player-safe feed is deferred.
Reload restores saved records and resets open/unread presentation. Scene revisions
refresh the feed; focus and a six-second fallback reconcile late-committed receipts
and reconnect gaps with ascending cursor catch-up and ID deduplication.

Deferred: Player-safe log, cross-scene/session-wide aggregation, imported historical
out-of-combat receipts, arbitrary free-form GM notes, rolls/interactions without
reliable persisted outcomes in this journal, and richer automatic rules resolution.
