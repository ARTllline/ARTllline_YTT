> Historical validation used the former container runtime. Current local commands: [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md); data migration: [LOCAL_MIGRATION.md](LOCAL_MIGRATION.md).

# Combat Gameplay — Task 27

## Ownership and execution

Persistent `Character.rules` still belongs to CharacterRules: scores, proficiency,
skills/saves, equipped AC/speed and spellcasting. Existing linked Character HP remains
persistent; this task does not migrate HP ownership. Token holds applied conditions;
Combatant holds action/bonus/reaction availability and movement spent. Standalone
Token has optional abilities/resources/combat_profile and needs no Character.

`CombatExecution` coordinates attacker, targets, attack/save contexts, shared damage
rolls and effects. `CombatStats` resolves CharacterRules or standalone NPC values;
`ConditionRules` adds contextual reasons, `TypedDamage` resolves components and
`AppliedConditions` owns lifecycle. Controllers validate intent; they never accept
final attack/save modifiers, AC, remaining budgets or damage multipliers from players.
Commands keep the existing campaign → scene lock order, transaction and UUID receipts.
Rejected execution rolls back budget, resources, HP, conditions and history together.
Durable AbilityExecution additionally protects retries after receipt cleanup.

## Turn and movement lifecycle

At combat begin all combatants receive initial resources. Each start of the actor's
turn resets action, bonus action, reaction and movement spent. Reaction can be spent
on another actor's turn and remains spent through intervening turns. It resets at
**the start of its owner's next turn**, matching SRD 5.2.1 p.10 (Reaction).
Action and bonus action require own current turn. `free` costs no turn resource;
incapacitated actors cannot execute abilities. Outside active combat turn costs do
not apply. Reactions are explicit abilities; no automatic reaction prompts/triggers.

Movement integrates with the existing `/tokens/{id}/move` command. Euclidean world
distance × distance_per_cell / grid_size consumes effective speed in feet. Linked
speed includes CharacterRules/equipment. No snapping/coordinate rewrite. An overrun
or off-turn move returns 422 and reconciles the rejected preview to server position.
Prone crawling costs twice distance. Stand up explicitly spends floor(speed / 2),
requires own turn and positive speed, and removes Prone. GM inspector position edits
remain an explicit editing bypass; normal GM drags use the same movement budget.

GM Previous/current navigation creates real end/start boundaries (and resets the new
actor), not time travel. Use GM budget override to correct state. Every transition
increments turn_sequence; stale Next/Previous requests remain conflict-checked.

## Ability metadata and damage

`activation`: action | bonus_action | reaction | free (legacy default: action).
`attack`: ability (str/dex/con/int/wis/cha/spellcasting), proficient, bonus.
`save`: ability, dc_source (fixed/spellcasting), dc, on_success
(negates/half/full), on_failure (full/none).
`damage_components`: up to four {dice, type} records.
`condition_effects`: up to four {key, when, duration_mode, rounds?} records;
when is hit/failed_save/successful_save/always. Checks may declare requires_sight.
Attack and target-save resolution are separate ability configurations.

Attack bonus and target AC are resolved from current authoritative derived stats.
Natural 1 misses; natural 20 hits and doubles damage dice, retaining flat bonuses
once. Nearby hits on Unconscious targets also crit. Target saves use their own
saving throw data and the caster's effective spell DC. AoE rolls damage once,
then rolls each visible target's save independently. Hidden tokens remain outside
player targeting/AoE, following existing visibility policy.

Damage component types come from local Compendium damage-types records. Same-type
components sum before rounding. For each type: save adjustment (half rounds down),
then resistance (halve, round down), then vulnerability (double). Multiple sources
of the same modifier do not stack. Immunity yields zero. This follows SRD 5.2.1
p.17, Damage and Healing. Qualified prose such as conditional weapon resistance is
retained in the copied source but is not parsed or executed. Legacy untyped damage
remains supported without matching typed defenses. History retains raw component
rolls, save results, adjustments, final damage and actor/target references.

## Conditions and expiration

The 15 canonical definitions/names/descriptions are existing local Compendium
conditions; no duplicate definition catalogue. Applied instances store token,
Compendium identity, visibility, source token/ability, applied time/turn sequence,
combat reference, duration and metadata. Reapplying the same source + ability +
condition refreshes its instance; different sources coexist without stacking the
same condition mechanic. GM-only instances never appear in player snapshots;
private reason details are replaced by a generic GM modifier in roll responses.

Implemented focused mechanics (verified against local SRD 5.2.1 glossary):

| Condition     | Automated mechanics                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Poisoned      | Disadvantage on attacks and ability checks; saves unaffected                                                               |
| Prone         | Own attacks disadvantage; attacks against advantage within 5 ft, disadvantage beyond; crawl/stand movement                 |
| Restrained    | Speed 0; own attacks disadvantage; attacks against advantage; DEX saves disadvantage                                       |
| Stunned       | Incapacitated; STR/DEX saves automatically fail; attacks against advantage; SRD 2024 does not set speed to 0               |
| Unconscious   | Incapacitated, speed 0, Prone; STR/DEX auto-fail; attacks against advantage; nearby hits crit; Prone remains after removal |
| Blinded       | Sight-required checks auto-fail; own attacks disadvantage; attacks against advantage                                       |
| Incapacitated | Blocks action/bonus/reaction execution                                                                                     |

Any advantage and disadvantage cancel, regardless of reason counts. Provenance
retains the contributing reasons. Automatic speech zones, awareness, dropping held objects, initiative penalties and
full visibility are not automated. Task 29 concentration is documented below. The
other canonical conditions are displayable/removable instances, not complete rules.
HP reaching zero does not automatically apply Unconscious or dying/death saves.

Duration modes: until_removed, until_start/end_of_source_turn,
until_start/end_of_target_turn, rounds. Boundary expiration happens before resetting
new turn resources. Rounds tick at the end of target turns, excluding the turn in
which applied, so N means N subsequent target-turn endings. Timed conditions require
active combat and participating source/target. Encounter instances clear on combat
end or target removal; source-turn instances clear when their source leaves combat.
Precombat until_removed instances and legacy/custom markers stay scene-scoped and
remain compatible. No condition is written into permanent Character rules.

## Compendium, UI and privacy

Monster copies take normalized scores, saves, proficiency, defenses and condition
immunities into campaign-owned combat_profile. Existing copies fall back only to
their immutable CompendiumCopy snapshot; changing a library entry cannot change a
campaign creature. Runtime uses local database records and performs no API calls.
GM may edit standalone scores/proficiency/spellcasting, ability metadata and simple
resistance/vulnerability/immunity profile in the expanded combatant controls.

Player Action Deck shows action/bonus/reaction and remaining movement. Disabled
slots explain spent action, reaction, resource or target availability through their
tooltip. Existing condition icons include duration tooltips; standing is an explicit
allowed action. Ability results show per-target saves/damage and public roll reasons.
GM can inspect/toggle budgets, set movement spent, reset a participant, apply/remove
canonical conditions and inspect the last 100 structured history events. History
and NPC defenses remain GM-only; other participants' private budgets are omitted.
Scene revisions publish budgets, HP and condition changes together; snapshot reload
reconstructs current state. No new accounts/campaigns/scenes are required for QA.

## Validation

2026-10-30, rebuilt Docker image, isolated test helper: **194 backend tests / 2343
assertions**, **175 frontend tests / 39 files**, all pass. Includes 14 focused combat
backend tests and five combat presentation/realtime tests. TypeScript, ESLint,
production Vite build and Pint (47 changed PHP files) pass. Docker doctor: all OK.

Chromium acceptance used only the permanent campaign 5 / scene 5 / session 1 and
three existing accounts. Verified STR16/PB3 attack, authoritative AC/DC, move 10 ft
→ 20/30 ft HUD, second action rejection, independent bonus/reaction reset timing,
full/half target saves and AoE, Fire half/double/zero, Poisoned provenance, Prone
crawl/stand, automatic expiration, duplicate UUID, reconnect, owner-only budgets
and GM history denial. All three clients received combat state over Reverb.
Native GM controls executed an NPC ability, edited/saved its activation metadata
and opened structured history. Desktop 1440×1000 and mobile 390×844 were visually
inspected; no page JavaScript errors or horizontal mobile page overflow. Other
browser engines and physical devices are not part of this verification.

Ignored evidence: `artifacts/task27-combat/{browser-report.json,tests.log,build.log,
doctor.log,player-combat.png,player-mobile.png,gm-combat.png}`. Original positions,
HP, abilities/resources/profiles, conditions, combat, scene revision and execution/
receipt/history rows were restored from a scoped private snapshot and compared
exactly. No accounts, campaigns, scenes or sessions were added for acceptance.

## Task 28 Items & Loot boundaries

Connect authored abilities/damage to equipped weapon/item definitions and inventory
provenance; resolve ammunition/quantities and equip changes atomically with budgets.
Add explicit item/weapon attack and damage stat scopes before weapon property,
armor formula, mastery or two-weapon rules. Define loot transfer ownership and
visibility with concurrent/idempotent inventory commands. Existing inventory and
basic consumable flows remain intact. Spell slots, upcasting, concentration, healing/
rest systems, cover, terrain, opportunity attacks and AI are separate future work.

Canonical reference: local `B:/DnD/Reference and Resource/DND_SRD_5.2.1/`.
SRD attribution and structured import provenance: [COMPENDIUM.md](COMPENDIUM.md).

## Task 28 item actions

[Items & Loot](ITEMS_LOOT.md) now supplies current equipped-weapon descriptors,
weapon-specific CharacterRules scopes, ammunition and physical thrown-item loot.
Its property support table distinguishes implemented and deferred behavior.

## Task 29 spellcasting and active effects

[Spellcasting](SPELLCASTING.md) extends the same Ability/Combat executor with slots,
cast-level scaling, healing provenance, temporary HP, managed effects and concentration.
The 2024 one-slot-per-current-turn restriction is separate from Action/Bonus/Reaction
budgets. Ending combat preserves slots and converts managed spell durations rather than
ending ongoing concentration arbitrarily. GM confirms reaction triggers and manual effects.

## Task 31 — GM session workflow

[GM Combat Console](GM_COMBAT_CONSOLE.md) consolidates runtime NPC actions, turn
controls, HP/conditions, bounded correction undo, secret batch checks, a readable
structured log and durable manual-spell resolution in the existing editor dock.
Gameplay engines and coverage classifications remain authoritative and unchanged.
