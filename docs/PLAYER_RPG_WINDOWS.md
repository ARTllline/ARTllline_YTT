# Player RPG windows

Inventory, Character / Equipment and Spellbook share `RpgWindow` and the warm Player RPG palette. The window is rendered through a React portal so HUD transforms cannot move its viewport coordinates. One major window is open at a time. The Action Deck remains reachable for drops. HUD buttons and I / K / C open the windows; Esc closes them. Inputs suspend shortcuts and reduced-motion preferences disable window animation.

## Model and authority

- Campaign `item_definitions` hold names, painted icon keys, descriptions, category, rarity, rectangular footprint, stack limit, compatible equipment slots, bounded static modifiers and an optional existing Ability UUID.
- Character `inventory_items` hold instance UUID, definition, quantity, bag x/y or equipment slot. The bag is 10 by 6; items never rotate. Depleted instances remain at quantity zero so hotbar references can show an unavailable state.
- `InventoryActions` serializes writers under the existing campaign lock. It validates ownership, bounds, occupancy, swaps, merge/split, equipment compatibility and replacement capacity. Give/remove and definition authoring require GM authority. Definition edits reject changes that would invalidate existing placements or stacks.
- Transport receipts include the route Character in their fingerprint and reauthorize ownership on replay. Durable `inventory_commands` retain mutation UUID, Character, fingerprint and result beyond transport receipt pruning.
- Item use resolves the owned instance and its server-side definition. It delegates to the existing Ability executor, then decrements quantity in the same transaction. A failed effect consumes nothing. The `item_only` flag prevents direct free execution of a consumable's Ability. Reusing an execution UUID cannot apply healing or consumption twice.

## Equipment and abilities

The paper doll has eleven initial slots: head, armor, cloak, gloves, boots, amulet, two rings, main hand, off hand and ranged. The Character window also contains the bag, HP, resources, conditions and named checks. Empty equipment slots show muted painted silhouettes; compatible drops are highlighted before confirmation.

`EquipmentStats` derives AC, speed and existing check modifiers from equipped positive-quantity instances. Base Character values remain stored once; linked Tokens, checks and attack defenses resolve the derived values. The GM editor receives base values to prevent saving an equipment bonus back into its own input. Resource maximum bonuses are outside this pass.

Spell metadata stays inside the existing Character Ability payload: level 0–9, school, class tags, known/prepared, ritual and concentration. Unknown spells are filtered from Player projections; unprepared spells remain inspectable but cannot execute. The book groups actions, cantrips and spell levels and offers category, prepared, class, school, level and text filters. Desktop catalog/details scroll independently; the 390px view opens details as a separate view with a Back control.

The GM's existing Character editor includes progressive Item authoring, give/remove controls and Ability spell metadata. There is no new independent spell executor or rules database.

## Shared drag contract

All gameplay sources use `application/x-ytt-gameplay-entry+json` with version 1 and a typed binding `{ sourceType: 'ability' | 'inventory_item', sourceId }`. `RpgDragProvider` owns native mouse and touch-hold interaction, source lift, a common painted drag ghost, target lookup and click suppression. `useGameplayDrag` is a thin Action Deck adapter over that engine. Hotbar persistence uses the existing version 2 layout; legacy Ability layouts remain readable.

Supported routes through that engine: bag → bag, bag → equipment, equipment → bag, equipment → compatible slot, item → hotbar, spell → hotbar and hotbar reorder. Item bindings identify actual inventory instances, rather than copying an Ability UUID into a nominal item slot.

## Verification — 2026-10-30

- Disposable Docker SQLite: 36 tests / 343 assertions passed across PlayerInventory, CharacterGameplay and persistent Character regression coverage. New cases cover denied ownership and receipt replay, forged/cross-Character IDs, bounds, collision rollback, valid swap, split/merge, auto-arrange, incompatible equipment, compatible slot swaps, full-bag unequip rollback, derived/base/linked stats, definition resize rollback, zero quantity, atomic effect failure, durable consumption retry and spell metadata/preparation.
- Frontend: 23 tests / 6 files passed in Docker; ESLint and TypeScript passed. Docker production frontend compilation passed. Pint and `git diff --check` passed.
- Real Chromium desktop and 390×844 touch emulation used normal GM/Player registration, invitation, authoring and gameplay APIs. QA records are isolated in the `RPG Windows · QA` campaign; they are not application seeds.
- Sword 1×3, shield 2×2, potion 1×1 ×3 and scroll 1×1 were created. Mouse grid movement, equip/unequip, shield AC 17 → 19 → 17, potion binding/use, spell binding and hotbar reorder were verified against persisted server state.
- Potion use changed quantity 3 → 2 and HP 17 → 25. Two simultaneous repeats of the exact original HTTP body/UUID returned HTTP 200 with `Idempotent-Replay: true`, the same execution UUID, and unchanged HP/quantity. A changed body with that UUID returned 409.
- Touch hold → item ghost → hotbar drop persisted the inventory binding. GM Item create/give/remove and prepared-state editing were exercised through the UI; an unprepared spell's Apply button was disabled. A normal targeted melee attack returned HTTP 200 with range validation and the existing check/damage executor.
- Applying a prepared level-2 Ability from the new book returned HTTP 200, spent mana 8 → 6 and left HP unchanged. Manual resource adjustment updated both the Character window and HUD; mana was restored to 8 through those controls after QA.
- The active Docker daemon was observed with no existing application volumes before normal startup in this run. QA used a separate newly registered test group. No restore, seed, volume deletion or host dataset modification was performed; this pass does not verify the historical imported dataset.

## Screenshots

These are actual browser captures, compared with the local `BG3_ui/inventory-character.jpg` composition: unified upper navigation, painted objects, quiet brown/bronze frames, a portrait surrounded by gear and distinct readable stats. BG3 screenshot pixels were not shipped. Imported icon sources are recorded in `public/assets/player/SOURCES.md`.

| Desktop | 390px |
| --- | --- |
| [Inventory populated](../artifacts/task23-inventory.png) | [Inventory](../artifacts/task23-inventory-390.png) |
| [Item drag](../artifacts/task23-item-drag.png) | [Character](../artifacts/task23-character-390.png) |
| [Character equipment](../artifacts/task23-equipment.png) | [Spellbook](../artifacts/task23-spellbook-390.png) |
| [Equipment drag](../artifacts/task23-equipment-drag.png) | [Touch drag](../artifacts/task23-touch-drag-390.png) |
| [Spellbook overview](../artifacts/task23-spellbook.png) | |
| [Spell details](../artifacts/task23-spell-details.png) | |
| [Spell to hotbar](../artifacts/task23-spell-hotbar.png) | |

Screenshots and build logs live in ignored `artifacts/`; source and this guide are reviewable in the working tree.

[Overview of the three windows and their 390px versions](../artifacts/task23-overview.png).

## Remaining UX limits

- At 390px the spatial bag keeps useful touch cell sizes and scrolls horizontally. Character equipment, bag and secondary state sections stack vertically. Touch dragging does not yet scroll a distant destination into view; explicit Equip/Unequip and Bind actions provide alternatives.
- Spatial placement is direct manipulation; there is no full keyboard cell-placement mode. Hotbar binding buttons and keyboard window/targeting controls remain available.
- Small-screen details and long inventories scroll. Physical phones, Safari/Firefox, multi-hour sessions and large multiplayer load were not verified in this pass.
- Bonuses are intentionally limited to AC, speed and named checks. There are no resource-capacity bonuses, equipment rules engine, encumbrance, crafting or economy.
- An item's use Ability must be configured on the receiving Character. Item definitions are campaign reusable, but this pass does not add a global library of item-action templates.
