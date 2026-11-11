# Campaign scene preparation

GM campaigns now open a scene collection at `/campaigns/{campaign}/scenes`.
Create a scene, choose a map from the global Asset Library, configure dimensions
and grid, then open the existing tabletop in Prepare mode. Blank scenes work too.
Scene settings save atomically, including map validation, through the existing
command receipts and SceneActions. Legacy image preparation keeps its existing format.

Optional editable maps now start from **Create editable map / Edit map** inside
Prepare. [MapWorld foundation](MAP_WORLD.md) adds bounds, reference placement/crop and
visual grid calibration, using the same viewport, Scene state and Session runtime.
The MAP-02 Map Editor now opens here with object placement/Inspector, local layer
visibility/locks, edit history and a personal material library. Foundation/grid
settings remain available from its settings button.

The read-only GM preview uses the existing Pixi renderer and image loader and
includes hidden objects. Campaign scene lists and preparation commands require
campaign GM permission; players retain their existing active-scene projections.

Prepare opens a **Содержимое** catalog in the existing right dock: Characters,
NPCs, Props, Containers and Interactions. **Карта** switches to the current Map
Editor with its contextual mode toolbar and panels (Terrain/Build/Objects/Fog).
There is one secondary surface; opening scenes or another dock replaces the catalog.
Selecting a scene entity replaces the catalog with its existing Inspector. Category,
search, source and page survive that transition within the current workspace visit.

The catalog and Session Add share EntityPicker and the existing library APIs.
Click a card or drag it onto the canvas: both use the existing Pixi placement ghost
and scene commands. NPCs, Props and Object Presets repeat until Esc, finish, a tool
change or a different category/search. Campaign Characters already on the scene are
disabled; Character placement ends after one instance. Props offer images or Object
Presets, retaining preset transforms/colliders/lights. Container/Interaction reuse the
existing purpose presets; their detailed configuration remains in Inspector.
Catalog closure, UI drops and cancelled native drags do not place entities. Shared
ScenePersistence/SaveQueue, revisions, history, authorization and Reverb are retained.
Queued failures use the existing retry state; confirmed retries clear that error.

An assigned campaign hero retains its Character identity across scenes. Other
global heroes create independent campaign runtime snapshots, including inventory;
the original remains global and its assignment is unchanged. Campaign-specific
ability references must pass existing validation in the destination campaign.
NPC placements reuse NpcLibrary's independent copy and prepared-loot behavior.

Duplicate copies scene settings, map references, fog, notes and token/prop layout,
including visibility, transforms and token conditions. Player Characters remain
linked; NPC Characters and their carried inventory are copied independently.
Combat, active spell effects, loot containers, interactions, regions, automation,
cues and sessions are not copied. The duplication dialog explains this scope.

Open for preparation never activates a scene. Preparing an already active scene
uses normal realtime behavior and therefore affects connected players. Launch /
Open in Session activates the selected scene when needed, then opens the existing
Session Workspace. It does not create a GameSession or start combat. Explicit
`?mode=prepare` / `?mode=session` takes precedence over the saved workspace mode.

Validation: ScenePreparationTest covers atomic settings, rollback, global map
references, receipt replay, snapshots, character placement and library isolation,
duplicate layout/NPC isolation, and GM/player/cross-campaign boundaries. Browser
smoke reuses the permanent playground without creating persistent scenes/sessions;
evidence is ignored under `artifacts/scene-preparation/`.

Catalog placement retains its existing history scope: token movement and supported
object/map edits, including plain Prop/Object Preset presence. Character/NPC catalog
creation and arbitrary token properties are not undoable. Group operations below
add their own atomic presence/visibility inverses, including Containers/Interactions.
History is local to the mounted workspace, not restored on reload. Batch property
editing and reusable encounter templates remain outside this change.

PREP-01 Chromium evidence: `artifacts/prep01/qa-report.json`, catalog, placement and
selection screenshots. QA reuses Scene 7, restores active scene/Fog and removes its
temporary library/runtime entities; no new accounts, scenes or sessions.

## PREP-02 — entity selection and authoring translation

Prepare → Содержимое uses the existing temporary token/prop ID selection. Click
selects one member; Shift+click toggles it. Empty-space drag selects intersecting
footprints, including rotated props with their real pivot. Shift+drag adds without
toggling existing members. Token hit targets remain usable at small zoom; actual
footprints take precedence over expanded targets. Tokens render above Props;
marquee can select overlapping entities together.

Dragging any selected member translates the whole composition using one snapped
anchor and one shared delta. Pixi previews all members and a shared frame. A click
without a drag collapses the group to that member. Space/pan and zoom retain the
selection. Esc first cancels an active gesture, then clears selection on the next
press. Clearing selection returns the PREP-01 catalog with its search intact.
The right dock replaces single-object properties with a compact group Inspector
with counts, manual visibility state, selection and group operations.

Authoring is enabled only in Prepare outside Map Editor. Build/Terrain/Fog retain
their separate gestures and selections. No persistent group model is introduced.
The existing `/scenes/{scene}/selection` endpoint accepts `action: translate`, the
existing selected IDs/anchor and exact expected world positions of all members.
GM authorization and SceneSelection resolution happen under SceneTransaction.
Every expected position, lock and coordinate limit is checked before any write.
One rigid translation updates only token/prop x/y, preserving Character snapshots,
containers, interactions and RPG state. It never invokes TokenMovement, combat
movement budgets, navigation/collision paths or movement triggers. This is GM
scene composition, including across walls and outside the visual map, consistent
with existing placement coordinate limits (±1,000,000).

One SaveQueue job, receipt UUID, revision and filtered Reverb delta confirm the
operation. A definitive rejection reloads canonical state, retains valid selection
and shows its reason; transport errors retain the same UUID for Retry. One history
entry restores all affected coordinates atomically. Expected source positions make
that inverse safe even when an unrelated revision interleaves. Ordinary history
limitations for NPC creation and arbitrary token properties remain unchanged.

Limits: at most 200 members per transform; a locked member blocks the group;
concurrent position edits reject/cancel the gesture. Selection and history are local
to the open workspace; reconnect retains valid IDs, while reload clears selection
and local history but preserves the committed scene. Group rotate/scale and batch
edit remain deferred. Reusable composition presets are described below.

Validation: PreparationSelectionTest plus ObjectGesture, marquee, ScenePersistence
and SceneHistory regressions. Scene 7 Chromium captures/report are in
`artifacts/prep02/`; temporary fixture, active scene and Fog are restored after QA.

## PREP-02B — group operations

The Prepare group Inspector offers Duplicate, Delete, Hide and Show. Duplicate
(also Ctrl+D) starts one transient Pixi composition with original transforms/pivots
and a shared frame. One click places the whole composition using a snapped anchor;
Esc cancels without a write and retains the original selection. Remote source edits
invalidate placement. The committed copies become the new selection. Delete uses
the existing compact confirmation and removes scene instances, preserving library
templates and campaign Characters. Campaign NPC runtime snapshots remain available
after scene removal, as with ordinary token deletion.

NPC Characters and inventory definitions/items are independent copies through
NpcLibrary. Loot containers/items/definitions are copied independently; interaction
actions get fresh UUIDs, keeping supported same-scene Cue/campaign Handout targets.
Conditions preserve their supported state and remap internal source-token links.
Player-owned Characters cannot be duplicated. Preset snapshots, colliders, embedded
prop lights, GM-hidden state, positions, scales and rotations retain their values.

Duplicate/Delete reject the entire operation for locked members, combat membership,
gameplay execution/effect references, Cue targets, triggers, completed object checks,
external condition links or attached scene light sources. These relations are not
silently dropped or replayed. The server returns the reason to the Inspector. Limits:
200 members and 512 KiB of serialized presence data per command; retained Character
and item dependencies use fingerprints. Oversized
graphs reject with a request to select fewer members. Hide/Show reject locked members
but otherwise change only `is_hidden`; Show continues through server LOS/Fog and
recipient projection. Mixed state is displayed explicitly.

Each operation uses SceneTransaction, one revision/receipt, SaveQueue and filtered
Reverb deltas. Duplicate/Delete return an encrypted scene-bound graph only to the
requesting GM for one SceneHistory presence step. Undo/Redo restores original IDs,
conditions, loot contents and links, checks current data/dependencies, and rejects
conflicts atomically. Visibility inverses use server-captured prior flags, restoring
mixed states in one step. History snapshots are omitted from all Reverb payloads.
Transport retries retain their UUID; terminal refusals reconcile canonical state
without blocking later operations. No persistent group model is introduced.

Validation: PreparationSelectionTest and selectionOperations.test cover atomic
mixed operations, clone isolation, graph/visibility inverses, link/lock conflicts,
receipt replay, retry, GM/player boundaries and filtered projection. Chromium on
Scene 7 uses two GM contexts and both existing Players; evidence and restoration
checks are in `artifacts/prep02b/qa-report.json` and adjacent screenshots.


## ENCOUNTER-01 — scene-local encounter preparation

Prepare → **Столкновения** opens the existing right dock. Create an empty draft or
create from selected NPC/Character tokens through the Group Inspector/single-token
context. Cards show name, participant count, composition, reserve count and manual
Draft/Ready state. Selecting a card selects its referenced tokens using PREP-02;
ordinary map gestures edit the same instances and their placement.

Each composition contains a main group and up to nine named reserve groups. Add
selected scene tokens to a group, move participants between groups, exclude a
participant, rename or delete the Encounter. Exclusion/deletion never removes scene
tokens. Deleting a reserve group moves its members into the main group without
changing their visibility. Marking Ready requires a nonempty main group; removing
all main participants displays Draft.

The embedded NPC Library uses EntityPicker and the existing PREP-01 click/drag
placement. A target Encounter/group travels with the transient placement intent.
NpcLibrary retains its independent Character/inventory clone; TokenActions adds
membership inside its existing SceneTransaction before publishing. Reserve NPCs
start with ordinary `is_hidden=true`, so no initial visible frame/event is sent to
Players. Moving an existing token into reserve does not hide/reveal it: the dock
shows visible reserve counts and offers the existing Hide selection action. No
visibility subsystem or automatic reinforcement reveal is introduced.

`scene_encounters` stores scene-local metadata/group names; `scene_encounter_members`
references token instances with cascade deletion and one membership per token per
Encounter. No RPG state, positions, combatants, initiative or round state is copied.
The same instance can participate in multiple prepared Encounters; its placement,
visibility and RPG state are shared. Entity duplication creates independent tokens
without inheriting Encounter membership. Whole-scene duplication retains its prior
layout-only scope and does not copy prepared Encounters.

GM-only `/scenes/{scene}/encounters` commands use IdempotentMutation, SceneTransaction,
SaveQueue and full expected-composition comparisons. Stale edits reject atomically
and reconcile; ambiguous transport retries keep their UUID. GM snapshots/reconnect
include the prepared compositions; Reverb sends only changed Encounters/removal IDs.
Players receive neither names, group membership nor hidden participant references;
non-vision recipients receive a revision-only event, and vision projections retain
the existing safe whitelist. Creation, restore and receipt replay recheck permissions.

SceneHistory supports Encounter create/edit/delete and existing group placement,
translation and visibility edits. PREP-02 entity-presence history captures membership
with the encrypted graph and fingerprints referenced Encounter metadata. Deletion
prunes membership in the same scene revision; Undo restores original token IDs and
membership, refusing deleted/changed Encounter dependencies atomically. History is
local to the mounted workspace and clears on reload. NPC/Character creation through
the catalog remains outside presence Undo, matching PREP-01; excluding the new
participant remains undoable. Concurrent unsafe inverses are refused, never forced.

Limits: 50 Encounters per scene, 200 unique token references per Encounter, ten
groups including main. Preparation is GM-only; runtime launch and reinforcements
use ENCOUNTER-02 below.

Validation: SceneEncounterTest covers permissions, receipt replay/role loss, scene
boundaries, secret filtering with/without Vision, persistence, stale membership,
reserve placement isolation, PREP-02 duplication/deletion and history conflicts.
EncounterPanel tests cover incremental patches, queue retry/reconciliation,
selection and history. Reversible Chromium QA uses Scene 7, two GM contexts and both
existing Players. Screenshots and restoration evidence: `artifacts/encounter01/`.

## ENCOUNTER-02 — prepared composition into live Combat

Session → **Столкновения** opens a compact optional overlay in the existing dock.
It lists this scene's prepared compositions and main/reserve counts. Details show
participants and runtime state without the preparation editor. Launch confirmation
selects existing scene player-character tokens. The main group and selected heroes
join the existing Combat Engine, referencing their original token/Character state.
No token, HP, resource, condition or RPG-state copies are made.

A new combat uses the normal prepare/add/begin lifecycle atomically. An existing
preparing or active combat requires explicit confirmation and its current ID;
the command only adds participants. A preparing combat retains its ordinary manual
initiative/begin workflow. New combatants have unset initiative (`—`), ordinary
initial budgets, and append to the queue. GM sets initiative and optionally sorts
or reorders in the existing Combat Workspace. Joining mid-combat never sorts,
advances a turn, resets a round, or resets an existing actor's budget. Joining an
active combat interrupts a newly added Character's spending rest, as combat begin
does. Subsequent turn boundaries use TurnBudget and existing lifecycle rules.

Each reserve group or individual can be activated in that same combat. Activation
does not reveal tokens: the eye action invokes ordinary GM-hidden mutation, with
the existing server Player projection, LOS/Fog/Lighting still authoritative.
Death, HP changes and conditions remain on the original actors. Combat removal
and token deletion retain their existing engine cleanup. A removed activated
actor is shown as withdrawn and is never re-added by a late activation retry;
deliberate manual add remains available in Combat Workspace.

`scene_encounter_runs` keeps only the encounter/combat link and historical activated
token IDs, with a unique encounter identity. These are launch/activation guards,
not RPG state. They survive preparation deletion/Undo and actor removal; historical
IDs are not projected as live scene entities. Combat/scene deletion cascades the
guard. Combat status is joined from Combat, never maintained independently.
GM snapshots and relevant incremental commands include `encounterRuns`; player
snapshots and events omit preparation and runtime membership metadata entirely.

`/scenes/{scene}/encounters/combat` uses the existing UUID receipts, SaveQueue and
campaign → scene lock order. Composition and target combat comparisons reject
stale confirmations atomically. Ambiguous retries preserve their UUID. Durable
guards also prevent another launch or duplicate reinforcement after receipt expiry,
including after combat completion. Completed compositions remain completed; a
late command cannot start the fight again. Reconnect hydrates the same links and
the ordinary authoritative combat snapshot. Runtime commands have no preparation Undo.

Validation: EncounterCombatTest covers linked Character ownership, durable retries,
existing-combat confirmation, overlapping activation, withdrawn/deleted actors,
preparation Undo, turn budgets, HP/conditions/rest, permissions and both Player
projections with LOS. SessionEncounters tests cover SaveQueue retry/reconciliation,
realtime, stale receipts, completion and Player guards. Reversible Chromium QA on
Scene 7 covers GM + both existing Players, lost launch acknowledgement, manual
initiative/turns, group/individual reserves, a second Encounter joining active
Combat, independent visibility, reload/reconnect and completion. Scoped database
restoration was compared exactly. Evidence: `artifacts/encounter02/qa-report.json`.

## PREP-03 — containers and interactive objects

Selecting a prepared container shows its contents in the existing Inspector, in
Prepare and Session. GM inspection reads closed containers without opening them.
Search Item Library or campaign items, click to add a copy or drag a card into the
contents. Cards show icons and supported item facts, quantity, replacement and
removal. Quantity edits respect the stack limit; replacement preserves the chosen
quantity and uses existing stack splitting/merging. Global templates remain
unchanged; library copies become independent campaign ItemDefinitions.

Interactions use the same Inspector editor and server actions, with quick Inspect
and Interact starters, character stat/skill selection, checks, results and player
availability. Custom stat keys and sight/DC options remain under Advanced. Results
are still only Nothing, Handout or Cue. Checks do not introduce a new loot access
gate: container opening and pickup retain their existing rules.

Authoring uses the existing SaveQueue and receipt UUIDs, with container-version
and interaction-draft comparisons. Ambiguous writes survive Inspector closure and
retry with the same UUID. Contents and configuration edits use encrypted,
scene-bound SceneHistory inverses. Undo rejects changed item ownership, contents,
definitions or completed object checks; it never rolls back pickup or check
receipts. Open/close and gameplay actions remain outside authoring Undo. History
is local to the workspace and clears on reload. Snapshots/Reverb still carry only
container summaries and recipient-safe actions; contents are read through the
authorized loot API and refresh on authoritative container versions.

Validation: ContainerPreparationTest, ObjectInteractionTest, existing loot,
inventory and selection regressions, plus SceneHistory/ScenePersistence tests.
Reversible Scene 7 browser evidence is under `artifacts/prep03/`.

## Global composition presets

The Prepare Group Inspector offers **Сохранить как пресет** with name, optional
description and a composition preview. **Содержимое → Пресеты** lists the GM's
personal compositions across all campaigns, with search, member/item counts,
rename, independent template duplication and confirmed deletion. No separate
composition editor is introduced. Rename/delete use expected preset revisions;
stale catalog entries must be refreshed. A private owner-only Reverb channel
invalidates other open catalogs after committed save/rename/copy/delete commands;
subscription/reconnect refreshes the current page. It carries IDs/revisions only.

The server captures a versioned, explicit authoring snapshot under campaign/scene
locks and checks the source revision. It never stores references to live scene
instances, NPC templates, item definitions, encounter membership or player owners.
NPC base stats, abilities, inventory, transforms, visibility, prop snapshots,
colliders, embedded prop lights, portable actions and filled containers are copied.
HP/resources/spell slots/hit dice start full; conditions, temporary HP, exhaustion,
life/rest state, verbal blocking and gameplay history are excluded. Removed item
stacks are omitted. Item-definition links within each inventory/container are
remapped together. Campaign images/icons become independent private personal
media; library images remain referenced. Preset references protect media from
deletion/replacement, including icon-only dependencies. Deleting a preset never
deletes placed entities or their media.

Click and native drag use the same Pixi composition ghost with original sizes,
pivots, rotations and a shared frame. One snapped anchor translates every member;
Esc cancels locally. Each placement creates fresh NPC/prop/container/item/action
identities in one SceneTransaction, receipt, revision and filtered Reverb delta.
SaveQueue retries ambiguous placement commands with the same UUID. Save-dialog
retries also retain their UUID and freeze an uncertain draft. One encrypted
scene-bound presence inverse removes/restores the complete composition through
ordinary SceneHistory. Copies have no live connection to the preset; editing,
deleting or placing it again cannot change earlier instances. Reload/reconnect
hydrates committed instances; local history still clears on reload.

Safety limits: 1–200 selected entities and 512 KiB of portable snapshot/presence
data; world anchors must stay within ±1,000,000. Player Characters, locked entities,
unsafe gameplay/automation/light links retain PREP-02B refusals. Interaction results
must be Nothing (including both check branches); campaign Handout/Cue targets,
spell material-definition links and item links to character abilities are refused
with a reason before any preset or partial placement is committed. Map geometry,
terrain, scene lighting setup, combat, scripts and nested presets are outside scope.

Validation: CompositionPresetTest, CompositionLibraryRealtimeTest and compositionPlacement.test cover portable
snapshots, fresh identities, item/equipment/media dependencies, atomic history,
stale revisions, permissions, privacy, retry and unsupported graphs. Chromium QA
on existing Scene 7/Campaign 5 and Scene 6/Campaign 6 uses separate GM/Player
contexts, lost-response retry, click/drag, Esc, Undo/Redo, Reverb, reload/reconnect
and catalog CRUD. Screenshots/report: `artifacts/compositions/`; temporary entities
are removed and both original scene projections are checked after restoration.
