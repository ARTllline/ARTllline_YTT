# Player action deck — 2026-10-30

This replaces Task 21's narrow one-row HUD composition. The accepted dice code and
presentation are unchanged. Scope: Player portrait/resources, deck bindings, layout
persistence, ability browser placement and drag/drop only.

## Composition

The desktop default is **8 × 2 immediately accessible slots**, 78px per slot at
1440/1920. The portrait is a separate 108px frame with a readable name, HP and turn
label. Resources have their own full-width rail above the grid. There is no card
surrounding the portrait, resources and deck together. Warm charcoal/brown surfaces
and bronze frames use the existing local RPG icon assets. The local BG3 `hotbar.png`
and `Throw_UI_Inventory_Menu.png` informed the multi-row density, resource home,
category tabs and placement interactions; BG3 pixels are not shipped.

Two pages, **Основное (1–16)** and **Резерв (17–32)**, share one 32-cell layout.
Expand shows all 32 cells in four rows. Collapse returns to the selected page.
Page changes, press/lift/drop states and the 170ms height transition respect reduced
motion. Page/expanded preference is browser-local, scoped by user/campaign/Character;
it is presentation state, not multiplayer gameplay state.

At 390px the same selected 16-cell page becomes one horizontally scrolling row of
60px slots. The resource rail uses two columns. Expand opens a bounded four-column
scrolling drawer containing all 32 cells; roll stance controls are available there.
The default does not squeeze sixteen icons onto the phone at once.

Shortcuts: 1–8 for the selected page's first row; Shift + 1–8 for its second row.
They are suspended for text inputs, dialogs, browser placement and edit mode. In
expanded view, the selected page keeps its shortcuts; the other page shows slot
numbers. Delete/Backspace clears the focused slot only. Edit exposes clear buttons;
clicking an empty cell opens the browser with that cell as the destination.

## Small binding and drop contracts

`hotbarModel.ts` owns the bounded layout and placement/swap operations. A supported
binding is `{ sourceType: 'ability', sourceId: '<ability UUID>' }`; a cell may be null.
Only ability is an implemented/accepted source type. Future inventory or skill
windows can publish the same versioned payload through `gameplayDrag.ts`:

```json
{
    "version": 1,
    "binding": { "sourceType": "ability", "sourceId": "<ability UUID>" }
}
```

MIME: `application/x-ytt-gameplay-entry+json`. `useGameplayDrag` owns native drag,
touch hold/lift, quick swipe, target feedback and settle state. It accepts a source
resolver, so it does not issue gameplay commands. Payload parsing is bounded and
rejects malformed/unknown versions/types. The deck checks the binding against the
active Character's available sources again before placement. An existing binding
swaps with its destination rather than duplicating itself. Hovering a page tab
switches the drop destination page; expanded mode also supports direct cross-page
reordering. Both the Ability Browser and deck publish this same contract.

`AbilityHotbar` composes navigation and the grid; `DeckSlot`, `AbilityBrowser`,
`AbilityCost` and `ResourceRail` handle their visual responsibilities. Activation
still passes the resolved Ability to the existing `choose` path. Targeting,
execution requests, checks, attacks, damage, server authority and realtime are not
modified by this work.

## Persistence / compatibility

The existing owned Character hotbar endpoint and JSON column are reused. No schema
migration or database reset is required. New responses/writes use:

```json
{ "version": 2, "slots": [null, { "sourceType": "ability", "sourceId": "<UUID>" }] }
```

The actual list has exactly 32 entries. Server authorization is still per user,
campaign and owned Character. Only enabled abilities on that Character may be
bound. Unknown types, missing fields, invalid/foreign UUIDs and duplicates are
rejected. Stale/disabled entries read as holes; other indices do not shift.

Legacy twelve-ID arrays retain their exact indices/holes and are padded with empty
cells. They are converted to the new representation on save. A cached twelve-slot
client can update its prefix without erasing cells 13–32. The existing serialized
save pump keeps the latest desired arrangement, exposes failures, and offers retry;
failed writes do not discard the optimistic arrangement.

## Resources

Every resource shows its actual icon, label and current/max. Small maxima (up to 6)
use round pips; medium maxima (7–12) use diamonds; larger pools use clear numbers.
Cost badges use the resource icon and larger amounts, separated from shortcut
labels. Unavailable actions retain recognizable art, a muted state and an ×. They
remain focusable so a tooltip can explain the specific missing resource. Activation
and shortcuts are blocked while unavailable; rearranging remains possible.

## Validation

- Docker production build / TypeScript, full ESLint: pass.
- Frontend: 17 tests / 4 files: typed binding compatibility and sparse swaps, payload
  validation, existing geometry/affordability and acting Character regressions.
- Disposable PHP/SQLite: 2 focused tests / 37 assertions: ownership, legacy arrays,
  typed cross-page persistence, unsupported/malformed/foreign binding rejection,
  stale entry filtering and preservation of later cells on legacy writes.
- Pint: the 3 changed PHP files pass.
- Real Chromium: 16 cells normal, 32 expanded, native slot swap + reload, browser →
  empty slot, Delete clearing, cross-page tab-hover drop to cell 32, and reverse
  moves restore the original QA arrangement. Drag/drop issues no execute request.
- A forced 503 save failure retains the moved action; Retry + reload preserves it.
- Mana temporarily changed from 10 to 0 through the normal resource API: spells
  remained visible, tooltip named Mana, clicking sent zero execute commands. Mana
  restored to 10 (200 response). Other HP/resources were not altered by this work.
- Multiple Characters: separate layouts and view preferences; Mira's empty deck and
  Kern's configured deck remain independent. Mobile touch swipe/hold and overflow
  checked separately. Physical phones and Safari/Firefox remain unverified.

Screenshots in ignored `artifacts/`:

- `task22-1920-normal.png`, `task22-1920-expanded.png`, `task22-1440.png`
- `task22-resources.png`, `task22-insufficient-resource.png`
- `task22-slot-drag.png`, `task22-browser-drop.png`, `task22-390.png`
- `task22-character-switcher.png`, `task22-390-expanded.png`

## Future Inventory / Skills windows

There is no inventory, equipment, consumable or spell subsystem in this change.
Adding a real source will require an authorized server resolver, matching binding
validation, an entry presentation/availability resolver, and dispatch into that
source's real execution workflow. Quantity/charges belong to that future source,
not to this layout's canonical state. External windows can reuse the existing MIME
publisher and drop target without replacing pointer handling or layout storage.
