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

On the tabletop, Add → Characters / Creatures exposes global Character and NPC
libraries with search, followed by the existing click-to-place interaction. Props,
movement, inspector, map placement, autosave and realtime use the current runtime.
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
