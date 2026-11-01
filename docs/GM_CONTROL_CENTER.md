# GM Control Center

The GM Hub is a top-level area at `/control/characters`, with a prominent entry
on the home screen. Campaigns open the Session Workspace; the existing campaign
shortcut redirects to this same library with an optional campaign filter.
There is one builder and one editor, independent of campaign navigation.

The library contains the signed-in user's player characters and characters shared
through campaigns where the user is GM. It can be opened,
and characters can be created, before any campaign exists. NPCs remain in their
existing campaign/runtime workflows and are not included in the library.

## Ownership and assignment

- `library_user_id` owns the character independently of `campaign_id`.
- `campaign_id` is nullable and represents one current campaign assignment.
  `owner_user_id` remains the optional player assignment within that campaign.
- Existing player characters retain IDs, tokens and player assignments. Migration
  assigns library ownership to the first existing campaign GM (lowest user ID).
  Campaign GM authorization for existing runtime APIs is preserved.
- Library routes expose owned characters and current campaign-GM collaboration access.
  Changing an existing campaign assignment requires library ownership and GM
  permission in the target campaign. Players do not gain access to the GM library
  projection of an assigned character.
- A character with scene tokens, active spell effects or active inventory cannot be moved or detached.
  Remove those in the existing workflows first. Empty historical inventory rows
  are retired on transfer; player selection and the private campaign portrait are
  cleared. Campaign-specific ability references must pass existing validation in
  the new context. This is not a multi-campaign sharing system.
- Deleting a campaign detaches its characters instead of deleting their library
  records. The migration refuses a rollback that would discard independent data.
- Global commands reuse the existing mutation receipt pipeline with a nullable
  campaign reference, retaining per-user idempotency and ownership checks.

## Character workflow

- Create: `/control/characters/new` uses eight steps:
  Identity → Origin → Abilities → Skills/Saves → Combat → Equipment → Spells → Review.
  A persistent hero preview uses server-derived modifiers. Standard Array swaps
  assignments; Point Buy has 27 points (8–15); Advanced Manual accepts 1–30.
  Dice rolling is deferred: the live dice pipeline is tied to existing actors.
- Origin is optional descriptive species/background metadata, without rules bonuses.
- Existing campaign items and compendium spells can be selected before confirmation.
  Character creation, inventory grants and spell copies share one transaction and
  the existing idempotency boundary. Failure rolls everything back.
  Items start in the backpack; equip them and configure spell slots after creation.
- Edit: `/control/characters/{character}` keeps quick tabs for
  Identity, Attributes, Skills/Saves, Combat, Inventory, Spells, Resources and Access.
- Identity: name, existing private campaign token image as shared portrait/token,
  and assignment to one existing campaign player. Unassigned means GM only.
- Stats: existing RulesEditor, server preview, skills, proficiency, saves and
  special checks. New-character rules defaults come from CharacterRules. Portrait and
  spell assignment require an optional campaign assignment. Saved characters can
  receive global items without a campaign. The creation wizard retains its existing
  optional campaign item picker; the new interactive workflow opens after creation.
- Combat: current/max HP, base AC/speed, exhaustion, Hit Point Dice and resources.
  Death/revival restrictions still apply; exhaustion uses LifeCycle.
- Inventory: RPG equipment silhouette, 10×6 backpack and the personal global Item Library.
  Drag from the library to a cell/slot, between slots, or back to the bag. Double-click
  equips/unequips; click opens item facts and explicit actions. Split, arrange, remove,
  grip and proficiency reuse InventoryActions. Rare instance settings live in details.
- Spells: existing assigned abilities, removal on Character Save, and a small
  paginated spell picker using the existing compendium copy action. Existing
  SpellcastingEditor manages slots and scroll access with its own Save action.

In the existing-character editor, Character fields require Save. Inventory commands, spell assignment and the
explicit spellcasting Save persist separately and immediately. Save character
changes before issuing these independent commands. Navigation warns about
unsaved Character or spellcasting changes.

The global library requires sign-in and private library ownership; campaign assignment and runtime commands retain campaign GM checks. Existing Character API authorization,
private portraits, player roster filtering, snapshots and incremental events are
reused. There is no separate character system. A nullable JSON origin field is added with a normal migration; existing characters remain compatible.
The Character save endpoint additionally accepts validated exhaustion and Hit
Point Dice; rules preview accepts an omitted ID for an unsaved character.

`DELETE /api/library/characters/{character}` uses library/GM authorization. The
legacy campaign delete endpoint remains available to the campaign GM. Both refuse
characters represented by any scene token (409). For an unlinked
character, existing foreign keys delete dependent inventory/spell/hotbar data
and clear active-character selection. The UI requires explicit confirmation.

Duplicate/archive, NPC tools, generic compendium/assets modules, new ability or
spell editors and progression remain outside this slice.

## Validation

`ControlCenterTest` covers GM routes, cross-campaign links, player boundaries,
creation/editing, rules preview without persistence, ownership, lifecycle,
delete restrictions, runtime snapshots and reconnect projections. Related
CharacterRules, inventory, spellcasting and lifecycle suites protect the reused
systems. Live browser checks must use `TEST_PLAYGROUND.md` accounts and remove
any temporary Character created for this workflow.

`CharacterLibraryTest` covers campaignless create/edit/preview/delete, private ownership,
GM assignment boundaries, runtime/token continuity, detachment and campaign deletion.

## Global Item Library → Character equipment

`/control/items` and `/api/library/items` expose the signed-in user’s private,
campaign-independent templates. Templates reuse validated ItemDefinition fields,
weapon/armor authoring and ItemFacts. No campaign-specific ability links are allowed.
A grant creates a detached runtime ItemDefinition snapshot and ordinary InventoryItem;
editing a template never refreshes previous grants. Identical snapshots are reused
within one Character to preserve existing stack/merge behavior. Other Characters
have independent snapshots. Legacy campaign definitions remain unchanged.

`/api/library/characters/{character}/inventory` requires library access and, when
assigned, campaign GM permission. Mutations reuse InventoryActions, its locks,
receipts, equipment rules, CharacterRules and incremental publishing. A direct slot
grant is atomic, can use a free slot with a full bag, and rolls back on incompatible
slots, two-hand conflicts or insufficient replacement capacity. Independent inventory
can follow a Character into a campaign; campaign-specific inventory still blocks
reassignment. Existing scene/token and active-effect transfer restrictions remain.

Quantity, placement, equipped slot, weapon proficiency/grip and optional charges belong
to the instance. Charges are an explicit GM-managed counter for non-stacking items;
no charge consumption/recharge rules are inferred. Runtime consumption continues to
use the existing quantity/ability pipeline.

The shared RPG drag provider, external-source slot/grid targets, searchable illustrated
catalog, hover facts, click inspector and explicit action alternatives can support a
future Spell Library. This slice does not create a generic drag framework or alter
Spells, NPCs, progression or Session Workspace UI.

Focused coverage: `ItemLibraryTest`, CharacterLibrary, PlayerInventory, CharacterRules,
ControlCenter and ItemsLootGameplay. Live QA uses the permanent fixture and restores
its modified inventory.

## Global Spell Library → Character Spellbook

`/control/spells` exposes the existing global SRD Compendium spell templates without
requiring a Campaign. The same searchable, paginated catalogue is embedded beside
Character Spellbook. Filter by circle/school; inspect hover facts or full source text.
Drag a card into the book, double-click it, or use +. Assigned templates are marked;
preparation has its own star toggle. Removal and access/preparation commands save
immediately. Existing non-spell abilities remain in their own category.

Assignments are independent snapshots in the existing Character abilities JSON,
with their own UUID and source entry identity. Template sync does not rewrite them.
The server serializes mutations with campaign/Character locks, validates existing
ability rules, checks library ownership plus GM permissions when assigned, rejects
duplicate assignments and publishes the existing filtered character.updated events.
Receipt replay rechecks permissions and campaign assignment. No second cast engine,
slot state, or template-to-runtime live link was added.

Reused from Item Library: illustrated library cards and inspector styling, RpgIcon,
hover tooltips, shared RpgDragProvider (native and touch hold), click details and
explicit quick-action alternatives. Spellbook adds circle groups, preparation marks,
known/access flags, slot summary and existing SpellcastingEditor. The existing
AbilityEditor and RulesEditor remain inside Advanced for per-Character overrides;
they do not edit the global template.

GM authoring: Spell Library supports Create, Edit custom, and Duplicate/Copy to custom.
Custom spells are private to their library owner; imported SRD is read-only. Copies
retain source attribution and use the existing Ability, combat and spell-effect schema.
Cards, painted icon selection, details and a draft preview share the existing RPG UI.
Item Library supports Create/Edit/Duplicate, painted icons, combat sections, Advanced
properties and a live card preview. Consumables can author existing embedded actions
without a campaign. Charges remain instance properties configured in Character Equipment.
Editing either template never rewrites assigned inventory or Spellbook snapshots.

Current limits: import/sync stays in Compendium. The existing 24-ability
limit, FULL/PARTIAL/MANUAL coverage and GM manual-resolution gates remain. Characters
can receive and prepare spells without a Campaign; session casting and slot editing
use the existing Campaign flow. The creation wizard keeps its previous Compendium
picker; the new Spellbook is available after saving the Character. No automatic
classes/progression or Effect Engine v2. Art selection uses the bundled painted icons.

Validation: SpellLibrary, Spellcasting, ItemLibrary, CharacterLibrary, ControlCenter
and CharacterRules feature tests; frontend spellcasting tests, typecheck/build and
focused ESLint. Native browser QA uses campaign 5 / scene 5 / Character 6, including
global browse, hover, drag, prepare, reload, player Spellbook and actual cast with
one slot spent. Abilities, HP and slots are restored exactly afterwards. Evidence
is ignored under `artifacts/module02-spells/`.

## Character Sheet controls

The Character Editor uses score cards with step controls and exact numeric entry;
modifiers and all final skill/save bonuses come from the existing server preview.
Pending calculations show an ellipsis instead of a stale total. Skills support search,
a trained-only filter and explicit proficiency/expertise choices. Hover a final
skill/save bonus to inspect its server-provided sources. Proficiency configuration,
manual bonuses and legacy checks are under Advanced.

Resources use accent cards, bars, clickable pips for small pools, spend/recover
controls and exact current-value entry. Advanced retains names, maxima, recovery,
icons, ordering and player permissions. Reducing a maximum clamps its current value.
Combat shows derived AC/speed and HP controls; raw AC/speed remain in Advanced.
Edits stay in the existing draft/save flow. Builder score methods and quick Edit use
their existing controls; editing a saved hero does not enforce Standard Array.

## Global NPC Library → scene runtime

`/control/npcs` is the personal global GM NPC collection. Create from scratch,
Edit, Duplicate, or browse read-only SRD Monsters and Copy to custom. Templates
have no campaign assignment. Each placement creates an independent campaign
Character and linked token in an existing scene; it never starts another session.
Runtime damage, spell slots, resources and inventory cannot mutate the template.
Editing a template does not retroactively update deployed copies.

The editor reuses Character sheet attributes/skills, Ability Editor, equipment,
Item Library and Spell Library drag/drop. Save a new NPC before assigning items
or spells. Library assignments save immediately; save other draft changes first.
Slots are authored explicitly; there is no progression or encounter builder.
Portraits are uploaded to private global storage with the existing image validation.
Placement copies the image into campaign-private storage and follows ordinary
visible-token asset authorization. No campaign asset becomes globally readable.

SRD copies retain checksum, source version, license, attribution and the full
normalized stat block. Scores, skill/save totals, walking speed, HP, AC and simple
canonical defenses transfer. Simple attacks use the base damage component only;
conditional/additional damage, alternatives, traits and complex effects remain
GM-resolved reference text. Noncanonical qualified resistances remain in the
source reference instead of silently becoming unconditional runtime defenses.
Attacks/abilities are limited to the existing 24-slot authoring bound; the full
source is retained when more actions exist. Review copied mechanics before play.

Inventory defaults to ordinary runtime inventory. The optional “Рюкзак —
подготовленная добыча” setting moves unequipped backpack items into a closed
corpse-loot container on placement, using existing item transfers. Equipped items
stay with the NPC. Players cannot access corpse loot before the NPC is defeated.

Validation: `NpcLibraryTest` covers independent copies in two campaigns, private
portrait access and hidden-token filtering, shared item/spell assignment, SRD
immutability/base damage, active combat/action budget, retry idempotence, loot
privacy and snapshot persistence. Chromium smoke on the existing campaign/scene 5
and session 1 exercised Create/Edit/Duplicate/SRD copy, portrait upload, item and
spell drag/drop, placement, runtime attack and HP update, GM/Player WebSocket
updates and reload/reconnect. Temporary NPCs/items/portraits were removed.
Local evidence: `artifacts/npc-library/report.json` and screenshots (ignored).
