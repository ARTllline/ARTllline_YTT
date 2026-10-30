# Character rules foundation

Character rules are opt-in, GM-authored data in the nullable `characters.rules`
JSON column. No totals are stored. `CharacterRules` owns arithmetic and provenance;
`TokenCheckStats` resolves action/object check keys through that service. Linked
tokens read Character values; standalone NPC tokens keep their original fields.

## Model and precedence

- `scores`: `str`, `dex`, `con`, `int`, `wis`, `cha`, integer scores 1–30.
- Ability modifier: `floor((score - 10) / 2)`, including negative odd scores.
- `proficiency_bonus`: explicit 0–20, without level/class progression.
- Eighteen stable skill keys with Russian UI labels. Each has a configurable
  ability, proficiency, expertise and signed additional bonus. Expertise means
  twice proficiency; it replaces, rather than stacks with, ordinary proficiency.
- Six `save_*` keys: ability modifier + configured proficiency + additional bonus.
- `spellcasting_ability`: nullable. When configured, `spell_attack` derives from
  that ability + proficiency; the spell save DC is 8 + the derived spell attack.
- HP/max HP are the existing authoritative Character fields. There is no automatic
  Constitution HP rule. AC and speed remain explicit base fields, with equipment
  added by the same service. No automatic Dexterity armor rule is assumed.

Calculation order: ability → proficiency/expertise → configured additional bonus
→ equipped static modifiers → action-specific additional bonus. A bare ability
action can opt into proficiency with `check.proficient`; skills/saves own their
rank and cannot receive proficiency twice. `check.bonus` is a GM-authored additive
bonus. The old `check.modifier` is ignored whenever `stat_key` resolves a Character
or token stat; it remains the fixed fallback when no key is configured.

Equipment contributes only when equipped with positive quantity. Existing `ac`,
`speed`, and `checks` maps are retained. Ability-key equipment bonuses also flow
into dependent skills, saves and spellcasting. Bonuses targeting a skill/save add
only to that check. A `spell_attack` equipment bonus affects both spell attack and
the spell DC under this foundation's shared spellcasting formula. AC clamps to
0–99, speed to 0–999. A null base stays null. No equipment total is written back.
Removing equipment reverses its contribution on the next authoritative read.

## Compatibility and migration

The migration only adds a nullable column. Existing Characters remain on legacy
named modifiers until a GM explicitly enables rules in the Character editor.
The server supplies a conversion suggestion, retaining familiar skill/save totals
as additional bonuses. Ability aliases (`strength`, `dexterity`, etc.) map to the
stable short keys; `str_save` / `saving_throw_str` map to `save_str`.
`sleightofhand` and `animalhandling` map to the underscored skill keys.

An old ability modifier cannot recover its original score: the suggestion chooses
an even score, bounded to 1–30. Extreme custom modifiers and conflicting aliases
need GM review before enabling rules. Proficiency is never guessed from an old
total. The original named-modifier JSON is preserved for custom systems and
rollback. With rules enabled, canonical ability/skill/save keys take precedence
over those old numeric entries; unknown custom keys still work. Fixed Task 16B
object checks remain fixed until explicitly converted to a `stat_key`.

The GM roster provides raw AC/speed and legacy custom values for editing, plus a
separate `derived` DTO. Player and inventory DTOs provide effective values.
The token Inspector edits explicit base AC/speed and shows linked checks read-only,
directing the GM to the Character editor. This prevents writing derived totals
back into base values. The GM-only preview endpoint validates a draft and computes
it with existing equipment without persisting anything.

## Authority, history and realtime

Players send an ability/check identity, actor, target and roll mode, never final
totals. Only a GM can save or preview rules. Existing ownership, campaign locking,
retry policy, transport receipts and durable roll identities remain in force.
ObjectCheck and AbilityExecution persist the exact modifier breakdown at roll
time; replay never recalculates a historical roll after stats/equipment change.
Breakdowns include ability, rank, additional/action bonus and equipped item source.
Only the actor's authorized data appears; hidden target DC/result configuration
keeps its existing server redaction. Other players never receive Character rules
or private equipment from the owner's character snapshot. Character saves and
equipment changes use existing `charactersChanged` notifications and refresh paths.

## Acceptance fixture

STR 16 / DEX 14 / CON 15 / INT 10 / WIS 12 / CHA 18; proficiency +3;
Athletics and Perception proficient, Persuasion expertise, CHA spellcasting:

| Value                  | Result                     |
| ---------------------- | -------------------------- |
| Ability modifiers      | +3 / +2 / +2 / 0 / +1 / +4 |
| Athletics              | +6                         |
| Perception             | +4                         |
| Persuasion             | +10                        |
| Spell attack / save DC | +7 / 15                    |
| AC 15 + shield 2       | 17                         |
| Speed 30 + boots 10    | 40                         |
| Perception + amulet 1  | +5                         |

`CharacterRulesTest` creates this Character in isolated SQLite and covers the
pipeline, removal, legacy aliases, GM validation, player forgery, object checks,
attacks, persisted provenance and retries. `rules.test.tsx` checks that the UI
renders server totals without recomputing them and preserves legacy presentation.

Before Combat Gameplay, define defense/save targeting and damage scaling against
this resolver. Damage expressions remain explicit GM data. Spell slots,
concentration, action economy, progression, resistances, critical rules and
automatic conditions are intentionally outside this foundation.

## Validation — 2026-10-30

- Docker PHP 8.4: 61 relevant tests / 687 assertions passed (Character rules,
  Characters, gameplay, object checks, inventory and hotbars), isolated SQLite
  in memory and temporary storage. Persistent MySQL was never used for tests.
- Frontend: 38 files / 168 tests passed; TypeScript, ESLint, Vite production
  build, changed-file Pint and `git diff --check` passed.
- Live Chromium GM/Player: score editing and server preview, save and Reverb
  refresh, proficiency/expertise chips (+7/+10 Persuasion), equipment removal
  and re-equip, reload persistence; no browser errors. Visual review at
  1440×1000, 768×1024 and 390×844. Physical touch and other browsers unverified.
- Local QA fixture retained: campaign 2 `QA · Character Rules`, scene 2,
  Character 2 `QA · Герой правил`, with the acceptance scores and three items.
  Evidence: ignored `artifacts/character-rules-backend.log`,
  `character-rules-browser-report.json`, `character-rules-qa.json` and
  `character-rules-*.png`.
- All 11 Docker doctor checks passed; the normal additive migration is applied.
  The accessible Docker Engine initially had no YTT containers or named volumes;
  Compose created new volumes. The historical imported dataset described in
  AGENTS.md was not available in this Engine. No volumes, host data or backups
  were removed or restored. These browser checks used newly created QA data.
