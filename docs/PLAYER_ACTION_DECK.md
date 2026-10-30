# Player action deck — Task 25, 2026-10-30

## Composition

The primary visual reference is the supplied `BG3_ui/hotbar.png`. YTT adapts its
composition using existing local icons and CSS framing; no reference pixels ship.
The desktop deck consists of interlocking modules:

- Left: round hero medallion, HP overlay/bar, name plaque and portrait-based roster.
- Center: two framed four-column/two-row banks, with a deliberate separator.
- Upper strip: compact resource icons, current/max, pips/segments and utility controls.
- Bottom: framed Основное / Резерв page pills plus Книга / Предметы / Герой windows.
- Right: read-only protection, speed, combat round and current-turn context.

The default shows 16 cells: 64px at 1440, 70px at 1920. Expanded mode adds the second
16-cell page underneath. `deckPresentation.ts` maps bank cells to the existing
canonical indices; grouping never compresses holes or reorders saved bindings.
Shortcuts remain 1–8 / Shift+1–8 for the selected page. The other expanded page
shows absolute cell numbers. Delete/Backspace, edit controls and page-hover drops
retain their existing behavior.

At 390px a 62px portrait sits beside a two-row horizontally scrolling action belt.
Combat information becomes a thin strip above it. Resource pools scroll separately;
window entry points become icons. Expanded mode exposes all 32 cells in the belt
and makes roll-stance controls available. The page itself does not overflow.
Page/expanded preferences remain browser-local per user/campaign/Character.

## Sources and persistence

The server-owned version-2 layout retains exactly 32 nullable cells. Bindings may
reference an enabled ability or a usable inventory item owned by the Character:
`{ sourceType: 'ability' | 'inventory_item', sourceId: '<id>' }`.
Item quantities, execution and resource costs remain with their existing sources.

The shared RPG drag engine supplies pointer/native drag, touch lift, validation and
drop handling. The deck adapter presents valid, rejected, lifted and settled states.
Inventory, Spellbook and deck slots use that same engine. Moving an existing binding
swaps its occupied destination; external windows do not create duplicate bindings.
The existing serialized save pump, retry handling and legacy layout normalization
are unchanged. Category pills open the existing Task 24 windows; they do not filter
or rewrite the saved action layout.

Resources display actual labels and current/max; up to 6 use pips, 7–12 use diamond
segments, larger pools use numbers. Depleted pools and unavailable actions remain
recognizable. Existing affordability/activation logic still prevents execution.
The support module derives own-turn status from the player-filtered Combat DTO;
it does not infer a hidden combatant or add combat rules. Temporary disabled state
is labelled synchronization rather than incorrectly claiming a disconnection.

## Validation

- Rebuilt Docker application and frontend production assets.
- TypeScript and targeted ESLint: pass.
- Full disposable PHP suite: 157 tests / 1930 assertions, pass.
- Full frontend suite: 165 tests / 37 files, pass. Three new tests cover canonical
  bank mapping, all 32 indices and swaps across bank boundaries.
- Chromium integration checks and screenshots: `artifacts/task25-browser-report.json`.
  Dedicated QA25 campaign only; ordinary APIs exercise layout persistence, slot
  swapping, both external drop sources, hero switching, resource insufficiency and
  combat state. Dragging does not issue execution requests.
- Chromium touch emulation at 390px: hold/drop and reverse swap persist; a quick
  swipe scrolls without modifying the layout. CSS scroll snapping is disabled
  because it otherwise cancels the shared engine's incremental touch scrolling.

Screenshots: `task25-1920.png`, `task25-1440.png`, `task25-resources.png`,
`task25-category-reserve.png`, `task25-slot-drag.png`, `task25-item-hotbar.png`,
`task25-spell-hotbar.png`, `task25-combat.png`, `task25-390.png` under `artifacts/`.
Additional captures cover expanded layouts, hero roster and insufficient resources.

Physical phones and Safari/Firefox are not verified. At 390px long hero names are
truncated; the roster/details retain the full name. Many resource pools require
horizontal scrolling. No dice, targeting, spell resolution, inventory rules or
Task 24 window implementation changes are part of Task 25.
