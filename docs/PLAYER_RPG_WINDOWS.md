> Historical validation used the former container runtime. Current local commands: [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md); data migration: [LOCAL_MIGRATION.md](LOCAL_MIGRATION.md).

# Player RPG windows

Inventory, Character / Equipment and Spellbook share `RpgWindow` with a charcoal/teal folio, aged-bronze framing and iconic medallion tabs. The window is rendered through a React portal so HUD transforms cannot move its viewport coordinates. One major window is open at a time. The Action Deck remains reachable for drops. HUD buttons and I / K / C open the windows; Esc closes them. Inputs suspend shortcuts and reduced-motion preferences disable window animation.

## Model and authority

- Campaign `item_definitions` hold names, painted icon keys, descriptions, category, rarity, fixed 1×1 footprint, stack limit, compatible equipment slots, bounded static modifiers and an optional existing Ability UUID.
- Character `inventory_items` hold instance UUID, definition, quantity, bag x/y or equipment slot. The bag is 10 by 6; every item occupies one cell, including equipment and stacks. Depleted instances remain at quantity zero so hotbar references can show an unavailable state.
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

## Task 23 verification — 2026-10-30 (historical)

- Disposable Docker SQLite: 36 tests / 343 assertions passed across PlayerInventory, CharacterGameplay and persistent Character regression coverage. New cases cover denied ownership and receipt replay, forged/cross-Character IDs, bounds, collision rollback, valid swap, split/merge, auto-arrange, incompatible equipment, compatible slot swaps, full-bag unequip rollback, derived/base/linked stats, definition resize rollback, zero quantity, atomic effect failure, durable consumption retry and spell metadata/preparation.
- Frontend: 23 tests / 6 files passed in Docker; ESLint and TypeScript passed. Docker production frontend compilation passed. Pint and `git diff --check` passed.
- Real Chromium desktop and 390×844 touch emulation used normal GM/Player registration, invitation, authoring and gameplay APIs. QA records are isolated in the `RPG Windows · QA` campaign; they are not application seeds.
- Sword 1×3, shield 2×2, potion 1×1 ×3 and scroll 1×1 were created. Mouse grid movement, equip/unequip, shield AC 17 → 19 → 17, potion binding/use, spell binding and hotbar reorder were verified against persisted server state.
- Potion use changed quantity 3 → 2 and HP 17 → 25. Two simultaneous repeats of the exact original HTTP body/UUID returned HTTP 200 with `Idempotent-Replay: true`, the same execution UUID, and unchanged HP/quantity. A changed body with that UUID returned 409.
- Touch hold → item ghost → hotbar drop persisted the inventory binding. GM Item create/give/remove and prepared-state editing were exercised through the UI; an unprepared spell's Apply button was disabled. A normal targeted melee attack returned HTTP 200 with range validation and the existing check/damage executor.
- Applying a prepared level-2 Ability from the new book returned HTTP 200, spent mana 8 → 6 and left HP unchanged. Manual resource adjustment updated both the Character window and HUD; mana was restored to 8 through those controls after QA.
- The active Docker daemon was observed with no existing application volumes before normal startup in this run. QA used a separate newly registered test group. No restore, seed, volume deletion or host dataset modification was performed; this pass does not verify the historical imported dataset.

## Task 24 — hero folio rewrite, 2026-10-30

Primary composition references are `inventory-screen.webp` and `Wizard-spellbook.webp` supplied by the user. The broader BG3 folder is secondary. No reference screenshot pixels or new third-party assets ship: the existing licensed local painted icons and campaign portraits are reused.

- Inventory now combines a large hero/equipment cluster, a searchable 10×6 single-cell bag, capacity meter and a dedicated illustrated inspection column. Selection, rarity, stack counts, compatible equipment targets and rejected drops have distinct treatments.
- Character places resources/checks/conditions on the left, portrait and equipment in the center, and the satchel on the right. `HeroEquipment` is shared with Inventory. Switching windows clears item inspection so an old selection does not cover the next window.
- Spellbook uses horizontal level rows, Roman level markers, compact icon entries, prepared-state jewels and a separate detail pane. Class/prepared summary is prominent; secondary filters stay collapsible. Existing ability execution and Action Deck architecture are retained.
- `rpg-folio.css` supplies the shared composition and responsive theme over existing RPG interaction/authoring styles. No rules engine or new dependencies were introduced.

### Single-cell compatibility

`2026_10_30_120000_normalize_inventory_cells` changes definition width/height to 1 without changing instance IDs, coordinates, quantities, equipped slots or hotbar references. Shrinking old rectangles cannot create collisions. Its rollback keeps the valid single-cell sizes rather than inventing old dimensions. Definition saves accept legacy size fields but normalize them to 1; the GM editor exposes stack size only. Both server placement and client hit testing use a single cell regardless of stale legacy dimensions. Arrange orders by category/name, with ID as a stable tiebreaker.

### Current verification

- Docker rebuild and normal migration completed; application and dependencies healthy. No volumes or keys were reset. Only the isolated `Hero Folio · QA24` campaign received browser test mutations.
- Full disposable SQLite suite: **157 tests, 1930 assertions**. Includes legacy footprint migration preservation, last-cell placement, ownership, stacking/split, swaps, full-bag rollback, equipment and existing execution/hotbar regressions.
- Full frontend suite: **162 tests, 36 files**. TypeScript, targeted ESLint and production compilation pass.
- Real Chromium native mouse drag verified: last cell, occupied-cell swap, invalid equipment rejection, equip/unequip, derived AC, split/recombine, item → hotbar, spell → hotbar and bindings after reload. Zero page errors. Chromium touch emulation also verified hold → item ghost → hotbar persistence at 390 px. 390×844 layouts and spell detail/back navigation checked, along with reduced-motion behavior.
- Evidence: `artifacts/task24-browser-report.json`, `task24-final-tests.log`; screenshots below. Test records are local QA fixtures, not application seeds.

### Current screenshots

| State | Capture |
| --- | --- |
| Inventory overview | [Main](../artifacts/task24-inventory-main.png) |
| Selected item | [Details](../artifacts/task24-inventory-selected.png) |
| Character/equipment | [Equipped](../artifacts/task24-character-equipped.png) |
| Spellbook overview | [Levels](../artifacts/task24-spellbook.png) |
| Selected spell | [Details](../artifacts/task24-spell-selected.png) |
| Item drag | [Cell target](../artifacts/task24-item-drag.png) |
| Equipment drag | [Compatible slot](../artifacts/task24-equip-drag.png) |
| Spell → hotbar | [Deck target](../artifacts/task24-spell-hotbar.png) |
| Item → hotbar | [Deck target](../artifacts/task24-item-hotbar.png) |
| 390 px Inventory | [Inventory](../artifacts/task24-inventory-390.png) |
| 390 px Character | [Character](../artifacts/task24-character-390.png) |
| 390 px Spellbook | [Spellbook](../artifacts/task24-spellbook-390.png) |

Screenshots and logs are ignored local artifacts. The earlier Task 23 captures remain available for comparison.

## Remaining UX limits

- At 390px the ten-column bag fits the viewport with compact cells; selection opens larger item details below the grid. Character equipment, bag and secondary state sections stack vertically. Touch dragging does not yet scroll a distant destination into view; explicit Equip/Unequip and Bind actions provide alternatives.
- Spatial placement is direct manipulation; there is no full keyboard cell-placement mode. Hotbar binding buttons and keyboard window/targeting controls remain available.
- Small-screen details and long inventories scroll. Physical phones, Safari/Firefox, multi-hour sessions and large multiplayer load were not verified in this pass.
- Bonuses are intentionally limited to AC, speed and named checks. There are no resource-capacity bonuses, equipment rules engine, encumbrance, crafting or economy.
- An item's use Ability must be configured on the receiving Character. Item definitions are campaign reusable, but this pass does not add a global library of item-action templates.
