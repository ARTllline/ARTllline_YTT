# Direct Player interaction — 2026-10-29

## Local acceptance table

Open **http://localhost:8090/campaigns/21/play** as **Полигон · Игрок**.
The existing QA campaign and account are retained. Kern owns the prepared actions;
there is no new login, seed or production deployment.

- **Удар мечом**: melee 5 scene units, Strength, 1d8+3.
- **Выстрел**: normal 60 / long 120, Strength, 1d8+2.
- **Огненный шар**: placement range 150, radius 20, 2 Mana, shared 2d6 QA damage.
- **Пылающие ладони**: directional cone 15 / 60°, 1 Mana, shared 2d6 QA damage.
- Existing Perception and Healing actions remain available.

The nearby target demonstrates melee. The central group demonstrates ranged and
area targeting. The eastern post is beyond the bow's long range. A hidden QA token
is deliberately excluded from snapshots, preview targets and area execution.
The test board is a procedural local asset, not a required application asset.

## Interaction

Choose a slot or use keys **1–8**. World targeting stays on the map: the cursor
shows the ability, actual distance and area size/count. Click a valid token to run
an attack immediately. Invalid targets cannot confirm. **Escape / right click**
cancels. Keyboard **Tab/arrows** cycles token/prop targets; arrow keys position a
point template; **Enter** confirms. There is no gameplay target select.

The normal and optional long-range boundaries use the scene's existing ruler units.
Long range is an amber band, without implicit disadvantage or edition-specific
rules. The ordinary boundary is shown in the distance denominator until the long
band is entered. Out-of-range targets are muted red.

Circle/rectangle areas follow snapped cursor placement. Cone/line templates start
at the acting token and use cursor direction, fixed configured length and width.
Their aim point is clamped to reach, so aiming beyond the end does not stretch the
shape. Circle radius, cone, line and rectangle share the ruler/AoE drawing helper.
For a large circle, several affected targets, or a cost of at least 2 of a resource,
a second deliberate click at the same point confirms. Moving the pointer disarms
that confirmation. No modal confirmation form is used.

The Player radial combines existing object actions with a bounded contextual
subset of the active character's abilities. Unaffordable/out-of-range attacks are
disabled. The spell group opens the compact ability browser. Both paths invoke the
same ability execution/presentation.

## Hotbar

Twelve sparse slots are stored by **Player + Character** in `character_hotbars`.
Drag swaps assigned slots or moves into a blank. Delete/Backspace on a focused slot,
or the layout edit controls, removes only its assignment. The ability browser can
restore an action into any slot. Touch holds lift a slot/card before dragging; a
drag release is consumed so it cannot accidentally launch the ability.

Requests save complete layouts through current ownership/campaign authorization.
The local save pump serializes rapid edits and reports unconfirmed saves with a
retry. Preference edits use last accepted write wins across tabs; they are separate
from gameplay mutations. Disabled/deleted abilities are pruned on load. Empty slots
are intentional and persist. Changing active character loads its separate layout.

Small resources use pips, larger values use a compact track plus numbers. Costs
remain visible on assigned actions. Three stance buttons choose normal/advantage/
disadvantage before an action; rolls keep this mode in their retained UUID request.

## Authoring and visual boundary

GM ability authoring uses type/icon/stat chips, range presets, visual area choices,
size/width/cost sliders, an area preview and drag ordering. Exact custom values,
description and Cue/Handout references remain progressively disclosed. GM editor
chrome retains the existing design system. Warm charcoal, muted brass, ivory and
sage/plum accents are scoped to Player View and Player radial presentation.

The shared check/attack dice component uses shaded 2.5D facets, a short tumble,
settle, modifier/comparison and outcome sequence. Advantage/disadvantage displays
both server dice and clearly marks the discarded one. Damage gets a subsequent
small dice reveal. Unopposed effects do not pretend to roll a d20. Natural 1/20 have
visual treatment only. Reduced motion removes transforms/tumbling, without changing
the authoritative result or execution behavior.

## Server execution and limits

`AbilityGeometry` measures token centers using the same Euclidean conversion as
the ruler: world pixels / grid size × distance per cell. Range, dimensions, modifiers,
defense, costs and damage are read from the stored ability, never accepted from the
player. Only visible scene entities are resolved. Area victims are derived under
the campaign/scene writer locks; clients never submit an affected-token list.
Token centers determine area inclusion; token-edge intersection is not adjudicated.
Directional templates exclude their acting token. Circles/rectangles can include
friendly tokens, including the actor, and highlight them before confirmation.

An area uses one configured check (if any), one shared damage roll and one resource
cost, with each derived victim adjusted through the existing HP action. No saves,
cover, LOS, automatic long-range penalties, action economy or critical rules are
introduced. Existing abilities without range/area retain their prior behavior.

The existing durable UUID ledger and transaction protect range rejection, area HP,
resource costs and Cue/Handout acceptance. Rejected targets spend nothing. Accepted
retries return the same dice/victims/effects after receipt cleanup. Realtime projects
visible token updates and floating feedback per recipient; private HP/configuration
and hidden identities remain filtered.

## Evidence and remaining QA

Final automated run: **145 PHP tests / 1804 assertions**, **150 frontend tests / 32 files**.
Typecheck and production build ran in the rebuilt Docker image; ESLint and Pint passed.

Automated checks cover sparse hotbar persistence/ownership, swap semantics, scene
units, range rejection without spending, hidden targets, all four area geometries,
derived area victims, costs and durable retries. The prior RPG/check/Combat/realtime
suites remain part of validation.

Browser validation uses GM and the actual **Полигон · Игрок** in separate sessions,
including desktop drag/reload/remove/restore, bow range feedback, direct attacks,
advantage, radial attacks, circle/cone previews and resource effects. Chromium touch
emulation at 390 × 844 verifies hold/drag persistence without accidental execution,
real target taps, long-press radial, camera/zoom controls and the corrected ability
browser bounds. Reduced motion produced no die animation; switching to Mira loaded
an empty independent bar and switching back restored Kern's assigned slots.

An accepted-response-loss test applied one 2d6 roll to three derived victims, spent
Mana 3 → 1, then recovered after reload with exactly the same HP/resource state.
Kern's initial 34/41 HP, Mana 6/10 and Focus 3/3 were restored after acceptance QA.
Ignored screenshots are `artifacts/tactics-*.png`.

Physical touch hardware, Safari/Firefox, WAN and multi-hour soak remain unverified.
This is an incremental tactical interaction layer, not a full RPG rules engine.
