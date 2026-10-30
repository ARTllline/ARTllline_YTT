> Historical validation used the former container runtime. Current local commands: [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md); data migration: [LOCAL_MIGRATION.md](LOCAL_MIGRATION.md).

# Spellcasting — Task 29

Compendium → deliberate independent Character Ability copy → current access/slots → existing AbilityActions → CombatExecution. No runtime remote API, natural-language rules parser, classes or automatic progression. `SpellProjection` contains reviewed keyed recipes; `SpellMetadata` extends the bounded Ability contract. Existing campaign copies remain editable and are not silently refreshed.

## Access and persistent state

The existing spell `known` and `prepared` flags remain GM controlled. `available` is an explicit access gate; `casting` is a server-derived projection, never persisted/client-authoritative. Players see their known enabled spells, preparation, coverage, components, source text and current legal cast levels. Spellbook can cast directly or bind to the existing 32-slot Action Deck. One stable binding covers all cast levels; activation opens buttons/chips, never a select.

`Character.spellcasting` owns levels 1–9 `{max,current}`, explicit cantrip tier 1–4, an independently GM-confirmed scroll spell-list allowance, maximum normal casting level for scroll checks and an explicit verbal-blocked flag. Cantrips spend no slots. Slots persist between turns, combats and reloads. Only GM may configure maxima/current values, restore a level or restore all. No rest or class progression is inferred.

## Casting transaction and scaling

Every writer uses the existing campaign → scene lock order. UUID transport receipts and durable AbilityExecution/InventoryCommand records protect resources, action budget, damage/healing, conditions, concentration and item consumption together. Current membership/ownership is rechecked before replay. Cast level and effect choice are part of the durable fingerprint. Target IDs/points are intent; existing AbilityGeometry computes visible affected entities. The client cannot supply final damage, DC, modifier, slot totals or an affected target list.

Preparation, access, casting time, current slot, minimum/base level, configured materials, geometric targets and turn budget must validate. Invalid intent rolls back everything. Once a valid cast resolves, a miss or successful enemy save still spends Action/Bonus Action/Reaction and the slot. Cantrip damage uses only the explicitly configured tier; Character level is never guessed. Bounded same-die/fixed-value scaling increases the primary damage/healing/temporary-HP formula per slot. Unsupported dimensions and additional targets remain manual; their original text stays visible.

SRD 5.2.1 **p.105**, One Spell with a Spell Slot per Turn: each caster may expend only one slot to cast on the **current turn**, including an off-turn Reaction. `spell_turn_slots` records combat + caster + turn sequence. It is not the remembered 2014 Bonus Action rule. A cantrip remains legal when its action budget permits. Turn changes republish server availability, including disabled reasons. No combat means no modeled turn restriction.

Long casting is blocked from normal combat execution. GM can attest completion outside combat; only then are costs committed. There is no timer/scheduler pretending that an interrupted long cast finished. Reaction triggers are shown and adjudicated explicitly; no automatic reaction interception or rollback of an already resolved attack.

## Effects, damage and healing

Attacks, saving throws, full/half/negated effects, criticals, multiple typed damage components and resistance/vulnerability/immunity remain CombatGameplay operations. Spell attack and save DC come from CharacterRules. Healing uses the existing HP mutation path, capped at effective max HP, with the formula/roll and actual recovered HP retained.

Spell additions are restrained data primitives: fixed/dice healing, temporary HP, flat AC/speed modifiers, attack/save bonus dice, conditional apply/remove canonical Condition operations and managed duration. Existing damage/attack/save primitives remain unchanged in identity. No arbitrary code, forced-movement/path engine, resource scripting or recursive effect language was added. Same named flat/dice spell bonuses do not stack. Temporary HP replaces a lower pool and absorbs incoming damage before HP; absorbed damage still prompts concentration. Manual/partial casts persist a pending resolution marker; GM can confirm it through the spellcasting controls.

## Concentration and duration

`spell_effects` stores caster Character, source Token, Ability/source spell, affected Token IDs, linked condition IDs/modifiers, start time, concentration and bounded duration. Concentration is Character-owned; target token effects remain scene-scoped. Starting another concentration spell ends the old effect before resolution. Replacement, voluntary end, effect expiration, Incapacitated/Stunned/Unconscious/Paralyzed/Petrified and zero HP clean up linked effects and publish changes immediately.

SRD **p.179**, Concentration: taking damage calls the existing CON-save context with `min(30,max(10,floor(damage/2)))`. Log includes source spell, effect, damage, DC, roll, bonus dice/provenance and cause/result. Only linked conditions are removed. The caster HUD exposes the current concentration, remaining duration and voluntary stop control.

Round durations tick at the source's turn boundary. Short seconds/minutes become round counts during combat; longer durations use timestamps. Combat ending converts remaining rounds to timestamps; it neither restores slots nor arbitrarily ends concentration. `spells:expire` expires timestamped effects under campaign locks every minute; commands also reconcile expired effects. Long out-of-combat timing can therefore lag by up to one scheduler tick. Manual/until-dispelled durations require explicit removal. No world-time simulation.

## Components

Canonical SRD **pp.105–106**; all original V/S/M and material text remain visible.

| Requirement                        | Supported enforcement                                                          | Deferred/manual portion                                              |
| ---------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Verbal                             | GM-configured blocked speech prevents V casting, including scrolls             | Automatic silence zones/gag state                                    |
| Somatic                            | Metadata and rule display                                                      | Reliable hand/focus/feature exceptions; no invented approximation    |
| Ordinary M / focus / pouch         | Metadata and rule display                                                      | Class focus eligibility and automatic substitution                   |
| Explicit GM-reviewed material link | Campaign definition, inventory quantity, transactional consumption, UUID retry | Automatically inferring value/consumption from prose                 |
| Costly material                    | GM can configure a reviewed specific item/quantity                             | Economy, valuation and generic textual cost parsing                  |
| Scroll material exception          | M linkage is bypassed for item casting                                         | V/S still require canonical adjudication; configured V block applies |

## Spell Scrolls

Canonical SRD **p.244**, with cantrip/level-1 equipment summary **p.99**. An Item's `use.scroll=true` embeds a reviewed campaign spell. GM explicitly confirms the spell belongs to the Character's spell list, independently of known/prepared access; no Class model is fabricated. `scroll_max_level` represents the highest normally castable level for the scroll check, independently of slots currently remaining.

Scrolls cast at their fixed spell level, use normal casting time, no Character slot and no M component. A higher-than-normal spell requires a spellcasting ability check (no automatic proficiency), DC `10 + spell level`. Failed check consumes the scroll with no spell effect. Accepted casting consumes exactly one scroll even on attack miss/save success. Interrupted/invalid attempts consume nothing. UUID retries repeat neither check, effects nor consumption. Reading/Arcana copying into a wizard spellbook is not implemented.

| Scroll level | Save DC | Attack |
| ------------ | ------: | -----: |
| 0–2          |      13 |     +5 |
| 3–4          |      15 |     +7 |
| 5–6          |      17 |     +9 |
| 7–8          |      18 |    +10 |
| 9            |      19 |    +11 |

## Complete SRD audit

[All 339 entries and reasons](SPELL_COVERAGE.md): **9 FULL, 23 PARTIAL, 307 MANUAL**. The same classification powers copying and remains editable in the campaign. `php artisan spells:audit` validates every current local record without importing/copying it into campaigns. The reproducible test fixture is the existing local SRD 2024 spell dataset; licensing/provenance are documented in [COMPENDIUM.md](COMPENDIUM.md).

Known source defects include Guidance/Resistance components embedded in the range string and omitted structured cantrip/healing/upcasting information. Raw data and full text are retained. Trusted mappings supply only reviewed numeric mechanics. No source text is converted into executable code or guessed class progression.

## Validation

Verified locally on 2026-10-30 against the rebuilt Docker application:

- Full isolated PHP suite: **234 tests, 3640 assertions**, passed. Twenty-two focused
  Spellcasting tests cover attack/crit, slots/cantrips/scaling/downcasts, saving throws,
  AoE/half/resistance, healing/UUID, concentration replacement/damage/incapacitation,
  duration/linked conditions, the 2024 current-turn restriction, Reaction/Bonus Action,
  scroll values/check failure/consumption, component consumption, safe effect branches,
  flat roll modifiers, manual completion, GM-role receipt replay, sight-required healing
  and all 339 projections.
- Frontend: **189 tests in 41 files**, passed. Seven spellcasting tests cover slot
  display, cast-level buttons/scaled previews, prepared/known/component/reference states,
  disabled reasons, existing Spellbook/binding affordances, concentration and temporary HP.
  TypeScript, ESLint, production build and Pint passed. Docker doctor: **11 OK**.
- Current local Compendium audit: **339 records**, 9 FULL / 23 PARTIAL / 307 MANUAL,
  **0 invalid projections**. Every row, reason and source warning is in SPELL_COVERAGE.md.
- Existing GM and two player Chromium sessions verified native GM slot configuration,
  direct Spellbook spell attack **CHA18 + PB3 = +7**, native Spellbook → Action Deck →
  level IV chips → map AoE, **9d6** upcast and UUID retry, plus level III **8d6**, authoritative
  DEX half-on-save and Fire resistance. Existing friendly-fire confirmation was retained.
- The slot-per-current-turn rejection, exhausted-slot deck reason, concentration/HUD,
  previous AC-effect cleanup, failed damage save, Incapacitated, **4d8+4** Cure Wounds
  and no repeat healing/slot spending passed. Combat end preserved slot expenditure.
- An explicitly granted Poison Spray scroll with known/prepared=false used **+5**,
  no Character slot and exactly one item under UUID retry; revoked list eligibility
  blocked it without consuming the remainder. Native GM Identify completion and manual
  resolution confirmation passed.
- Desktop and **390×844** Spellbook/cast-level windows were rendered and visually reviewed;
  no page overflow or browser JavaScript errors. Reverb updated GM/caster state and
  reconnect reconstructed current slots/access. Evidence is ignored under
  `artifacts/task29-spells/` (reports, screenshots, build/static/test/Pint/doctor logs).
- Acceptance reused prepared **campaign 5 / scene 5 / session 1** and existing accounts.
  No accounts, campaigns, scenes or sessions were created. The scoped original backup,
  including all new spell state, was restored afterward and every backed-up row compared
  exactly. Persistent Docker data/keys/volumes were preserved.

Browser evidence is Chromium on this Windows machine with a mobile viewport, not a
physical phone, Safari/Firefox or public/WAN deployment. Rest, progression, full reaction
prompting, 3D/LOS/cover and the audit's remaining rule families are not claimed as automated.

## Rest recovery

[Adventuring lifecycle](ADVENTURING_LIFECYCLE.md) adds an explicit long-rest slot
recovery policy, shared healing/death handling and reconciliation of finite managed
effects during GM-confirmed rest. Indefinite effects remain; Long Rest sleep ends
the resting caster's concentration.
