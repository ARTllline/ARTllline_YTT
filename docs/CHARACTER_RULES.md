> Historical validation used the former container runtime. Current local commands: [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md); data migration: [LOCAL_MIGRATION.md](LOCAL_MIGRATION.md).

# Character Rules — SRD 5.2.1 foundation

`CharacterRules` is the authoritative calculation layer for Character checks,
attacks, AC, speed and spellcasting. `CharacterCatalog` supplies request-local
definitions from the installed `srd-2024` Compendium. Neither service calls HTTP.
Character RPG windows display server totals; their previews use the same resolver.

## Canonical data and persisted state

The eighteen skill definitions, names, stable keys and base abilities come from
local `CompendiumEntry` records of type `skills`. There is no second canonical
skill catalogue in PHP or TypeScript. Character skill state references its canonical
key and `compendium_entry_id`, and stores proficiency, expertise and additional
bonus. Source IDs are validated and rewritten from the authoritative catalogue.
Canonical skill abilities cannot be replaced by client skill metadata.

The existing nullable `characters.rules` JSON uses `schema_version: 2`:

- `scores`: STR/DEX/CON/INT/WIS/CHA, integers 1–30; final modifiers are not stored.
- `proficiency_bonus`: configurable integer 0–20. Level/class progression is absent.
- `skills`: canonical key → entry reference, `proficient`, `expertise`, `bonus`.
- `saves`: six ability keys → `proficient`, `bonus`.
- `spellcasting_ability`: an ability key or null.
- `modifiers`: bounded custom bonuses to `ac`, `speed`, `spell_attack`, `spell_save_dc`.

Before enabling rules, install the local skills with the existing sync command:

```powershell
php artisan compendium:sync srd-2024 --type=skills --type=conditions
```

Missing/incomplete skill data produces an explicit readiness state and blocks
enabling/saving rules. It never silently substitutes a hardcoded list or contacts
the external API. Existing legacy Characters remain usable without enabling rules.
The catalogue endpoint is `/api/campaigns/{campaign}/character-rules/catalog` and
requires campaign membership. It contains only canonical definitions.

## Calculation and modifier provenance

The canonical local SRD 5.2.1 PDF was checked at printed pages 6 (ability modifiers),
7–9 (checks, saves, proficiency and skills), and 23 (spell attack/save formulas).
The checked eighteen imported skill abilities match the SRD skill table on page 9.

- Ability modifier: `floor((score - 10) / 2)`; STR 16 → +3, WIS 8 → −1.
- Skill/save: relevant ability modifier + applicable proficiency + explicit bonuses.
- Expertise adds one further proficiency bonus; ordinary proficiency is never added
  a second time. History records `proficiency` and `expertise` as separate parts.
- Spell attack: casting ability modifier + proficiency + spell-attack bonuses.
- Spell save DC: base 8 + casting ability modifier + proficiency + spell-DC bonuses.
  A bonus targeting `spell_attack` does not automatically change `spell_save_dc`.
- AC/speed: explicit Character base + custom bonus + equipped modifiers, resolved
  through `coreStat`. Existing bounds remain AC 0–99 and speed 0–999. A null base
  remains unspecified. Full armor formulas/training are deferred.
- Speed is expressed in `ft`. HP/max HP are persisted Character gameplay state;
  Constitution does not automatically change them. Linked token HP writes still
  go through existing Character actions, and standalone token HP remains local.

Each result includes structured `breakdown` entries with source, label, value and,
for equipment, item ID. Skills also carry their compendium identity. Core breakdowns
include the base. `derived.abilityModifiers` contains the pure score-derived values,
so a raw check bonus does not change the score modifier shown on the six-stat cards.

Equipment contributes only when equipped with positive quantity. Existing `ac`,
`speed` and `checks` maps remain supported. Check keys are normalized through the
same alias resolver. A `checks.str` bonus affects the current STR-based action/check;
it is not an ability-score increase and does not flow into Athletics, STR saves or
spellcasting. Skill/save/spell bonuses target their own keys. Unequipping recalculates
the next authoritative result; no total is written back into a base field.

`TokenCheckStats` delegates Character resolution here. Ability attacks can select
`check.stat_key = str`, opt into proficiency, and add a GM-authored `check.bonus`.
The configured fixed modifier is ignored when a stat key is selected. With no stat
key, old fixed actions keep their behavior. Runtime requests supply action identity,
actor/target and roll mode; they cannot supply authoritative scores or modifiers.

## Migration and compatibility

No existing Character is deleted or reset. Characters without rules retain their
named modifiers until the GM explicitly enables rules. A server conversion suggestion
preserves familiar skill/save totals as visible additional bonuses and never guesses
proficiency. Missing scores use safe 10s. An old modifier cannot recover a unique
score, so suggestions use bounded even scores and require GM review.

Existing rule JSON is projected into version 2 on read, but is persisted only when
a GM saves. Historical noncanonical skill-ability overrides become explicit bonus
adjustments, preserving their current totals while restoring the canonical ability.
No ability metadata is stored in new skill state. Extreme legacy bonuses may require
GM review against existing validation bounds.

Aliases such as `strength`, `str_save`, `saving_throw_str`, `animalhandling` and
hyphenated skill names resolve to one canonical key. Snapshots publish one total
per canonical key. Original legacy JSON remains available for rollback/custom systems,
but cannot compete with active canonical rules. The GM custom editor hides reserved
canonical keys and preserves their old data while editing genuine custom checks.

Standalone NPC tokens retain their existing explicit modifiers and do not need a
Character record. Existing inventory, spellbook, resources, active Character and
hotbar flows remain. Compendium copies remain independent campaign content.

## Conditions and permissions

An additive migration adds nullable `token_conditions.compendium_entry_id` and links
existing canonical keys when the local data is present. New canonical conditions
reference the fifteen imported definitions, including Exhaustion. There is no
duplicate canonical condition selector list. Custom conditions and the existing YTT
`concentrating` marker remain available without claiming to be SRD conditions.
Condition mechanics are not executed. Conditions still belong to scene tokens.

Only a GM can save/preview rules, modify definitions or configure checks. Existing
campaign/ownership checks and campaign-first locks remain. Player snapshots include
only authorized Character data; GM-only conditions and hidden target configuration
retain server-side redaction. ObjectCheck and AbilityExecution preserve the modifier
breakdown and compendium reference at roll time. Retrying a UUID or a restricted
retry-policy check replays that historical result after later stat/equipment changes.

## UI and validation — 2026-10-30

The accepted RPG-window presentation is retained: six score cards, HP/AC/speed/
proficiency summary, eighteen canonical skill rows with proficiency/expertise marks,
six saves and separate spell attack/DC values. Tooltips expose breakdowns. The GM
editor uses score controls, rank chips, grouped saves, canonical ability labels,
casting-ability chips and bounded additional bonuses. No new visual language or
nested rules modal is introduced.

QA Character: STR 16 / DEX 14 / CON 15 / INT 10 / WIS 12 / CHA 18; proficiency +3;
Athletics/Perception proficient, Persuasion expertise, CHA spellcasting:

| Value                               | Result                     |
| ----------------------------------- | -------------------------- |
| Ability modifiers                   | +3 / +2 / +2 / 0 / +1 / +4 |
| Athletics / Perception / Persuasion | +6 / +4 / +10              |
| Spell attack / save DC              | +7 / 15                    |
| AC 15 + shield 2                    | 17                         |
| Speed 30 ft + boots 10 ft           | 40 ft                      |
| Perception + amulet 1               | +5                         |

Validation: 180 backend tests / 2186 assertions passed in isolated Docker SQLite;
36 focused rules/conditions/compendium/reusable-content tests / 510 assertions;
38 frontend files / 170 tests; TypeScript, ESLint, production build, changed-file
Pint, Docker doctor and diff checks. Tests cover canonical identity, modifiers,
separate spell bonuses, legacy projection, missing catalogue, raw/save/skill checks,
attacks, advantage, private conditions, structured provenance, replay and forgery.

Live Chromium GM/Player QA verified server preview and save, eighteen skill rows,
real Reverb refresh of equipped AC/speed/Perception without reload, player unequip,
reload persistence and forbidden player Character edits. Desktop 1440×1000,
tablet 768×1024 and mobile 390×844 were checked; physical devices and other browser
engines remain unverified. Evidence is under ignored
`artifacts/character-rules-compendium/`. The temporary QA campaign/account pair was
removed; the older prepared campaign 2 fixture and all other existing content remain.

## Before Task 27 Combat Gameplay

No blocker prevents consuming this resolver. Combat must introduce explicit attack,
save and damage contexts for more specific equipment/effect scopes; the current
foundation intentionally retains existing generic check-key semantics. Define target
save execution and damage handling separately from spell save DC derivation. Full
armor/weapon formulas, training, action economy, movement consumption, condition
effects, resistances, concentration and spell slots remain subsequent work. No full
rules engine or progression is implemented here.

SRD attribution and API provenance remain in [COMPENDIUM.md](COMPENDIUM.md).

## Task 27 implemented

The combat contexts, turn budgets, movement, typed damage and focused condition
mechanics described as future work above are now implemented in
[COMBAT_GAMEPLAY.md](COMBAT_GAMEPLAY.md). Persistent CharacterRules ownership is unchanged.

## Task 28 equipment formulas

[Items & Loot](ITEMS_LOOT.md) adds typed armor/shield formulas and weapon attack/
damage scopes to this resolver while retaining legacy manual bases and modifiers.

## Task 29 spellcasting

[Spellcasting](SPELLCASTING.md) adds persistent Character spell slots/access, explicit
cantrip tiers, scroll list eligibility and managed concentration/effects. Spell attacks
and DC still come from this resolver; active AC/speed modifiers use its breakdowns.
See [all 339 spell classifications](SPELL_COVERAGE.md) for exact automation limits.
