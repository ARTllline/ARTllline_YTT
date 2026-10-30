# Local SRD compendium

YTT stores imported definitions separately from campaign content. Gameplay, search,
details and copying use the local database only. No browser or gameplay service
calls the external API. No new dependency, automatic seeding of campaigns, or rules
execution is introduced.

## Sync

Run from the repository root, after rebuilding with `scripts/docker.ps1 up`:

```powershell
docker compose --env-file .env.docker exec --user www-data app php artisan compendium:sync srd-2024
docker compose --env-file .env.docker exec --user www-data app php artisan compendium:sync srd-2024 --type=spells --dry-run
docker compose --env-file .env.docker exec --user www-data app php artisan compendium:sync srd-2024 --type=equipment --type=monsters
```

Types: `spells`, `items`, `weapons`, `armor`, `monsters`, `conditions`, `skills`,
`rules`. `equipment` selects items, weapons and armor together. Equipment is fetched
once and classified into disjoint types; it is never duplicated as a second remote
record. `--force` rewrites selected entries even when unchanged. `--dry-run` fetches
and normalizes but writes no database data, including sync timestamps.

The importer fetches all requested documents before committing, checks index/detail
identities, retries transient failures, and requests at most eight details at once.
An HTTP, mapping or database failure leaves the previous catalogue and sync times
unchanged. Imports are serialized by a database source lock. No entries are deleted
when a source removes them: investigate source removals before retiring definitions.

For reproducible/offline imports, export the fetched API responses:

```powershell
docker compose --env-file .env.docker exec --user www-data app php artisan compendium:sync srd-2024 --export=storage/app/compendium-srd-2024-snapshot.json
docker compose --env-file .env.docker exec --user www-data app php artisan compendium:sync srd-2024 --snapshot=storage/app/compendium-srd-2024-snapshot.json
```

Snapshots include format version, source key, fetch time, endpoint coverage and
original JSON documents. Treat a snapshot as an import artifact; use a separate
snapshot for each endpoint selection. It is not needed for normal gameplay.

## Data contracts

- `CompendiumSource`: stable key, display name, canonical version, license, source
  URL, attribution/API reference metadata, per-type sync times, full-sync time.
- `CompendiumEntry`: unique `(source_id, entity_type, external_key)`, indexed slug
  and name, original `raw_data`, YTT `normalized_data`, canonical JSON SHA-256,
  normalizer version and import timestamp. An unchanged sync retains import time.
- `CompendiumCopy`: campaign, entry ID, target kind/key, optional character ID,
  source checksum/reference/version/license and immutable raw/normalized snapshot.
  Resync only writes compendium entries; these receipts and editable targets stay
  unchanged. Target names may be shortened to existing editor limits; full names
  and descriptions remain in the receipt. Receipts survive deletion of an ability
  or item; they record the import, not current ownership or existence.

Mappings live in `app/Compendium/Srd*Mapper.php`. Unknown API fields remain intact
in raw data. Increment `CompendiumSync::VERSION` for a changed normalized contract.
Classes, species, feats and backgrounds can later register endpoints and dedicated
mappers without new tables. They are not imported by this slice.

Units are explicit (`ft`, `lb`, original currency unit). Abilities use `str/dex/con/
int/wis/cha`. Skill, condition, damage and property keys use underscores, e.g.
`sleight_of_hand`, `animal_handling`, `poisoned`, `slashing`. Future consumers should
query local entries by source/type/key rather than add independent rules lists.
Character Rules consumes the local skill definitions and stores canonical skill
references. Condition selection also reads this catalogue, with optional links on
existing token conditions. Legacy freeform checks/conditions remain supported;
see [CHARACTER_RULES.md](CHARACTER_RULES.md) for the authoritative resolver.

The `rules` type contains namespaced reference entries from ability scores, damage
types, magic schools, weapon properties, weapon mastery properties and equipment
categories. This API has no 2024 `/rules` or `/rule-sections` endpoint. It is not a
complete imported rules glossary.

## Copies and GM UI

Open **Добавить → Компендий** as a GM. Search (literal name substring), type/source
filters, pagination, normalized preview, original data and attribution work locally.
Search selects only summary columns and returns 30 entries per page. Ordinary DB
indexes cover source/type/identity and name ordering; the small SRD catalogue does
not require an external search engine. Players and non-members cannot browse/copy,
and spell targets must belong to the same campaign. Copy requests use existing
mutation receipts, including permission rechecks on replay.

- Spell → ability on a selected existing Character. Maps level, school, classes,
  ritual/concentration, safe damage expression, compatible range/geometry and
  spell attack metadata. Imported abilities start disabled and unprepared for GM
  review. No resource costs or spell slots are invented. Saving throws, duration,
  casting time, components, scaling and full descriptions remain in the immutable
  copy snapshot; the current Ability editor does not represent all these fields.
- Equipment → `ItemDefinition`, editable through the existing item authoring UI.
  Weapon/armor categories and equipment slots map to existing supported values.
  Adventuring gear uses the current `trinket` UI category. Damage, mastery, cost,
  weight and AC semantics are preserved in the copy snapshot. No additive AC
  modifier is generated, including for shields: armor training is not implemented.
- Monster → reusable campaign `Character` with kind `npc`, editable through
  **Персонажи** and placeable on multiple scenes. Maps HP, unconditional AC,
  walking speed, ability modifiers and listed saving throw/skill totals. Scores,
  size/type, senses, other movement, resistances, actions and traits remain in the
  snapshot; monster actions are not converted to executable abilities. This uses
  existing persistent NPC content rather than introducing another template system.

GM API routes under `/api/campaigns/{campaign}/compendium`: GET list, GET `/{entry}`
(includes recent campaign copy receipts), POST `/copy`. These contain no HTTP import
transport. Sync is a server CLI operation only.

## Canonical checks and limits for Character Rules

The API documents its 2024 dataset as SRD 5.2, but does not pin each response to SRD
5.2.1. Source metadata explicitly separates the canonical **5.2.1** rules reference
from the mutable API dataset. Raw checksums, API `updated_at` and exported snapshots
identify the exact imported material; this is not a claim of a fully audited 5.2.1
machine-readable rules corpus.

Canonical local reference: `B:/DnD/Reference and Resource/DND_SRD_5.2.1/SRD_CC_v5.2.1.pdf`.
Checked printed pages: 1 (attribution), 9 (skills), 91 (Longsword), 92 (armor/shield),
131 (Fireball), 290 (Goblin Warrior). Conversion guidance remains available alongside
the PDF; no cross-edition conversion is performed by this importer.

- Fireball: level 3, Evocation, 150 ft, 20 ft radius Sphere, Dexterity save, 8d6 Fire,
  half on success, instantaneous, no concentration. The API omits structured area
  and save fields here. Narrow description extraction adds evidence-tagged hints;
  it is not a rules parser. Never infer executable mechanics from these hints.
- Longsword: 1d8 Slashing, Versatile (1d10), Sap. Shield grants **+2** AC; it is not
  base AC 2. Heavy armor base AC does not add Dexterity. These semantics are stored,
  not executed by the current item system.
- Goblin Warrior is the 2024 identity (`goblin` returns 404): Small Fey, AC 15,
  HP 10 (3d6), walk 30 ft, Stealth +6. Its conditional advantage damage remains
  text/data, not an unconditional second damage roll.
- Many spells omit structured saves/areas or encode target choices, conditions and
  scaling in prose. Extraction recognizes only narrow wording, and may describe
  only one of several mechanics. Cylinder height, reach/touch, special ranges,
  multiple damage types, healing and cantrip scaling need explicit future adapters.
- Monster save/skill data contains final totals, not reliable proficiency/expertise
  configuration. Some AC entries and speed strings are conditional. Do not reverse
  engineer full character rules from those totals. The API omits some stat-block
  details (e.g. Goblin Warrior subtype/initiative presentation) from structured data.
- Conditions and skills supply stable local keys/descriptions. They do not apply
  effects or determine a character's proficiency/training.

## Local verification (2026-10-30)

Docker/MySQL import: 970 entries — spells 339, items 131, weapons 38, armor 13,
monsters 341, conditions 15, skills 18, reference rules 75. A second complete import
from the saved snapshot created/updated zero entries; all 970 were unchanged.
All 339 spell projections passed the existing Ability validator and semantic checks.

Backend coverage includes HTTP sync, failure atomicity, dry run/force/type selection,
raw preservation, changed fixture updates, idempotency, equipment reclassification,
normalization, independent editable copies, provenance and GM/campaign permissions.
The browser copy/edit workflow also covers `rules: null` NPCs; nullable rules no
longer require a nested spellcasting field in the existing Character validator.
Final checks: 173 backend tests (2115 assertions), 168 frontend tests, TypeScript,
ESLint, production frontend build and Docker doctor passed. Ten backend tests are
specific to the compendium; the full suites include existing Character Rules work.

Chromium GM smoke checks used a separate temporary campaign with the external API
domain blocked: Fireball, Longsword, Shield and Goblin Warrior copies, source/type
filters, Poisoned/Perception details, editable NPC persistence. No external API
request was attempted. The temporary campaign/account were removed after QA.
This slice does not alter multiplayer commands or renderer behavior; physical mobile
devices and other browser engines were not tested.

## Attribution

This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”)
by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1
is licensed under the Creative Commons Attribution 4.0 International License,
available at https://creativecommons.org/licenses/by/4.0/legalcode.

Structured import source and API fixture provenance:
[D&D 5e API 2024](https://www.dnd5eapi.co/api/2024),
[API documentation](https://docs.dnd5eapi.co/2024/introduction).
YTT normalization and shortened descriptions are adaptations; they do not change
the underlying SRD. The repository contains only small focused JSON test fixtures,
not a copy of the entire SRD PDF.

## Combat Gameplay consumer

[Task 27](COMBAT_GAMEPLAY.md) consumes local canonical condition/damage keys and
monster snapshots for encounter execution. Campaign combat profiles remain editable
and authoritative; no runtime refresh or natural-language rule parsing is performed.
