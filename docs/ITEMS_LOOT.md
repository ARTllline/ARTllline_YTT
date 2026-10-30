> Historical validation used the former container runtime. Current local commands: [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md); data migration: [LOCAL_MIGRATION.md](LOCAL_MIGRATION.md).

# Items & Loot — Task 28

## Ownership and action architecture

Compendium Entry → deliberate, editable campaign ItemDefinition → owned InventoryItem.
Item definitions now have typed `gameplay` data and a nullable CompendiumEntry reference;
immutable CompendiumCopy receipts retain original raw data and unsupported SRD metadata.
Copies never refresh from the library during gameplay. No runtime API calls or prose parsing.
Only selected items are copied; no campaign-wide automatic library import.

Inventory remains 10×6 with one cell per item, quantities, split/merge, sorting and equipment.
An InventoryItem belongs exclusively to a Character or LootContainer. Transfers merge
compatible stacks deterministically by ID, then fill row-major free cells. A complete
unmerged stack retains its UUID; partial or merged transfers create/use appropriate stacks.
Zero-quantity rows remain harmless tombstones. Definitions are never duplicated by pickup.

`ItemActions` resolves a current item action descriptor, not a separate saved weapon Ability.
Stable action UUID = inventory instance UUID + use/throw mode. Existing Action Deck
`inventory_item` bindings remain unchanged. Every execution re-reads ownership, quantity,
definition, equipment, grip, proficiency and ammunition. Unequipping or editing a definition
cannot leave stale attack math. Unavailable items explain why; definite missing ownership
is displayed as unavailable, and server layout reload clears invalid references.

Per-instance weapon proficiency is an explicit GM confirmation. No class/proficiency system
is inferred. It resets on ownership transfer. Players can choose allowed Finesse ability
and supported grip, but cannot grant proficiency. New copies do not silently grant training.
Armor training and don/doff time remain GM decisions, visibly stated in item details.

## SRD rules implemented

Canonical reference: local SRD 5.2.1, Weapons pp.89–91, Armor p.92, Potion of Healing p.99.
Structured numbers and identities use local SRD 2024 records; ambiguous semantics were
checked against the PDF. Attribute scores and proficiency are resolved by CharacterRules.

- Melee uses STR, ranged uses DEX. Finesse defaults to the larger raw STR/DEX modifier,
  STR on ties; explicit STR/DEX choice is allowed. The same choice drives damage.
- Attack = ability modifier + confirmed proficiency + explicit weapon/weapon-attack modifiers.
  Damage = weapon dice + same ability modifier + explicit weapon-damage modifiers.
  Generic ability-check bonuses do not become weapon attack/damage bonuses.
- Versatile two-hand damage requires persisted two-hand grip and a free off hand.
  Two-Handed active weapons block off-hand equipment; shields occupy off hand.
  Weapon actions use the main-hand slot. The old ranged slot remains available for custom
  legacy equipment; it does not create a second simultaneously active SRD weapon.
- Normal/long distance uses existing AbilityGeometry world/grid conversion. Long range
  adds a disadvantage reason; beyond long range rejects. Advantage/disadvantage cancellation
  remains centralized. Reach extends melee reach to 10 ft. Heavy uses SRD 2024 score 13
  thresholds (STR for melee, DEX for ranged).
- Each accepted ammunition attack, hit or miss, expends one matching piece. Invalid target,
  out-of-range, missing action/ammunition or permission failure consumes nothing. One-handed
  ammunition weapons require a free loading hand. One action emits one attack/projectile.
- Thrown weapons use their proper attack/damage ability and throw range. The actual weapon
  instance leaves the Character and lands in a loot pile beside the target; it can be picked
  up, rather than being duplicated or destroyed. Ranged Thrown weapons such as Darts use
  this behavior for their primary attack too.
- Critical attacks double dice, never flat ability/equipment bonuses. Fixed damage such as
  Blowgun base damage is supported without inventing a die.
- Light armor = base AC + full DEX modifier. Medium = base + min(DEX modifier, 2), including
  negative DEX. Heavy = base with no DEX. Shield adds its bonus once. CharacterRules then
  includes compatible custom modifiers. Without SRD armor the existing manual base AC remains.
- Insufficient armor STR reduces speed by 10 ft where a score is modeled. Structured armor
  Stealth disadvantage participates in ability and object-check provenance.
- The explicit Potion of Healing mapping is a Bonus Action, range 5 ft, healing 2d4+2.
  It delegates to the existing Ability/effect pipeline, not a separate effect engine.

## Property support

| Property / rule                           | Status                                | Behavior                                                          |
| ----------------------------------------- | ------------------------------------- | ----------------------------------------------------------------- |
| Finesse                                   | Supported                             | Best STR/DEX default, explicit legal choice, same damage modifier |
| Versatile                                 | Supported                             | Equipment grip controls damage; shield/off-hand conflicts reject  |
| Two-Handed                                | Supported                             | Main-hand active weapon requires both hands                       |
| Thrown                                    | Supported                             | Range/context + physical item moves to world loot                 |
| Ammunition                                | Supported                             | Structured ammo key, matching stacks, one per accepted attack     |
| Range                                     | Supported                             | Normal/long/max geometric checks and contextual disadvantage      |
| Loading                                   | Supported within current action model | One projectile per action; extra-attack sequences are not modeled |
| Heavy                                     | Supported                             | SRD 2024 score thresholds add disadvantage                        |
| Reach                                     | Supported for attacks                 | 10-ft melee reach; opportunity attacks deferred                   |
| Light                                     | Informational                         | No extra/off-hand bonus attack or dual-wielding automation        |
| Mastery                                   | Informational                         | Name retained and shown; no mastery effects automatically applied |
| Special/unknown properties                | Informational                         | Preserved in copies, never parsed as executable prose             |
| Armor training / don-doff time            | GM adjudication                       | No class training or automatic casting restrictions               |
| Ammunition recovery                       | Deferred                              | No post-combat recovery bookkeeping                               |
| Nearby hostile interference / LOS / cover | Deferred                              | No threat, visibility or cover engine introduced                  |

## Usable items and Action Deck

An item can embed an authored Ability plus `consume` policy, so scrolls and special
consumables can grant actions without requiring a matching permanent Character ability.
The existing `use_ability_id` linkage is still supported. Item-granted actions require an
enabled definition but do not require the Character to know/prepare that spell; the explicit
SRD scroll/slot rules are now described in [SPELLCASTING.md](SPELLCASTING.md).

Quantity is consumed after an accepted effect/attack, within the same transaction. Retry
uses the original UUID and result. Reusable items can set consume=false. Dynamic healing
dice extend the existing healing result; no rest/healing subsystem was added.

Player inventory details/tooltips show dice/type, reach/range, properties, mastery,
requirements, training note, ammunition count, equipped state and source key. They never
expose raw normalized JSON or private embedded Ability result/DC configuration. GM authoring
adds structured weapon/armor/ammo fields and reuses the Ability editor for usable actions.
Compendium copy offers direct Give to Character / Put in Container. GM can also move an
actual held instance into a container; this is distinct from intentionally creating loot.

## World loot and permissions

LootContainer binds to an existing Prop, or a Token for manually prepared corpse loot.
It stores InventoryItem instances, open/closed state and a revision counter. Scene snapshots
and realtime carry only public container identity/state, not contents. Opening uses the
existing radial menu and an ephemeral RPG loot window with Take, quantity, Take All,
details and drag to the recipient inventory. GM can configure contents and close containers.

Players may open visible containers on the active scene and take into a controlled
Character. Distance/LOS restrictions are not invented. Closed container GET responses hide
contents until Open; hidden/inactive sources reject. Corpse loot becomes visible/accessible
after HP reaches zero. Preconfigured loot never automatically copies NPC equipped gear.

An explicit gift authorizes the sender to move their own item to another controlled Character
or a visible player Character of an existing campaign member. It grants no right to inspect
or pull from the recipient inventory. GM controls both sides. Drop places the real item into
an adjacent visible Prop pile; repeated drops at the same position reuse the pile. Anyone
permitted by scene visibility can pick it up. Nonempty loot sources cannot be casually
removed through token/selection deletion; contents must first be moved or explicitly removed.
Deleting an entire scene still follows the existing major scene deletion workflow.

Take All is all-or-nothing: if any remaining entry cannot fit, every merge/move rolls back.
No partial silent loss. The 1×1 grid is filled deterministically. Backpack, loot and source
quantities, equipment and derived stats are updated together. Relevant inventory/container
views update through existing scene revision channels; reconnect reads current state.

## Transactions, retries and compatibility

All inventory, loot and combat writers lock Campaign first, then Scene/owned rows as needed.
That one writer order serializes normal 4–8-player groups without a new distributed lock
system. Take, Take All, gift, drop, put, split, merge, equip, consume and ammunition all
commit atomically. Concurrent final-item pickup has exactly one winner; stale intent rejects.

Existing UUID transport receipts remain. Durable inventory_commands and loot_commands retain
accepted outcomes independently; duplicate UUIDs cannot duplicate items, damage or costs.
Current authorization runs before replay, and old privileged loot receipts reject after
role loss. Player projections redact hidden embedded-action configuration.

The migration is additive. Unmodified old Compendium copies can gain structured data from
their own immutable receipt. Definitions with custom modifiers remain legacy/manual until
explicitly configured, preserving campaign edits and avoiding double-counted old AC bonuses.
Custom slots, manual legacy gear and existing 32-slot layouts continue to work.

## Validation

Verified locally on 2026-10-30 in the rebuilt Docker application:

- Full isolated PHP suite: **212 tests, 2518 assertions**, passed. The 18 new
  ItemsLootGameplay tests cover weapon derivation/current edits, Finesse, Versatile,
  hands, ranged/Thrown, ammunition/retries/rollback, armor/Stealth, consumables,
  loot/Take All capacity and merging, permission filtering, corpse state, gift/drop,
  durable receipts and independent Compendium copies.
- Frontend: **182 tests in 40 files**, passed; seven focused item/loot tests cover
  tooltips, invalid equipment drops, inventory binding/availability, loot controls,
  one-cell grid and incremental shared-container state. TypeScript, ESLint, production
  build and Pint passed. Docker doctor reported all 11 checks OK.
- Chromium, existing GM and two player accounts: native item Action Deck targeting
  resolved STR16 + PB3 = +6; Chain Mail + Shield yielded AC18, returning to AC16
  after shield removal. Versatile used 1d10+3 only with a valid persisted hand state.
- Longbow arrows changed 3 → 2; identical UUID stayed at 2. Long range applied
  disadvantage, beyond 600 ft spent neither arrow nor Action. Empty ammunition
  disabled the preserved deck slot with an explanation.
- Potion of Healing used the Bonus Action and 2d4+2 pipeline, 3 → 2; identical UUID
  repeated neither healing nor consumption.
- Both players opened the same chest through the native world radial menu. Take
  updated the other player's quantity over Reverb. Actual concurrent requests in
  separate browser sessions against MySQL yielded **one 200 and one 409** for the
  last Longsword. Native Take All, gift, forbidden pull, drop/pickup, reconnect and
  broadcasts to GM and both players passed. Item totals were conserved.
- Native GM Add → Compendium → Dagger → Copy → Give/Put, structured dice editing,
  current generated action, inventory details → Drop → world radial Open → Take All
  passed. Thrown Dagger also left inventory as the same recoverable world instance.
  Desktop and 390×844 mobile loot were visually checked; no page overflow or browser
  JavaScript errors occurred.
- Evidence is local and ignored under `artifacts/task28-items/`: test/static/build/
  doctor logs, browser reports and screenshots. Only prepared campaign 5 / scene 5 /
  session 1 and existing accounts were used. The scoped backup was restored after QA
  and every backed-up row compared exactly. No prepared fixture content was replaced.

Browser coverage is Chromium on this Windows machine, including mobile viewport
emulation. Physical touch devices, Safari/Firefox and public/WAN deployment were not
verified by this local acceptance pass.

## Task 29 Spells & Spellcasting

[Spellcasting](SPELLCASTING.md) now supplies reviewed spell mappings, persistent slots,
cast-level scaling, concentration, managed effects and explicit scroll rules. Scrolls use
fixed SRD DC/attack values, a GM-confirmed spell-list allowance, no Character slots and
transaction-safe consumption/check failure. Components and unsupported spell mechanics
are explicitly classified; [the coverage audit](SPELL_COVERAGE.md) lists all 339 spells.
Reactions still have no automatic prompting engine.
Weapon mastery, full extra attacks/dual wielding, armor training/classes, economy, crafting,
encumbrance, attunement and loot tables remain outside this slice.

SRD attribution and structured source provenance: [COMPENDIUM.md](COMPENDIUM.md).
