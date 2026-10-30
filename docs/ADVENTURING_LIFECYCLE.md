# Adventuring lifecycle — SRD 5.2.1

Implemented locally on 2026-10-30. Canonical gameplay source is
`B:/DnD/Reference and Resource/DND_SRD_5.2.1/SRD_CC_v5.2.1.pdf`;
Compendium supplies condition identities and prepared campaign text, not an
alternative edition's gameplay rules. No classes, levels or campaign clock added.

## Ownership and transactions

`Character.lifecycle` persists one status (`alive`, `dying`, `stable`, `dead`,
`defeated`, `unconscious`), death-save successes/failures, required/resolved turn
identity and cause. Independent Tokens have the same runtime fields; linked Tokens
delegate to Character. Exhaustion is a cumulative integer, not a boolean condition.
Character also owns explicitly configured `hit_point_dice`, `rest_state`, slots,
resources and optional GM-recorded `recovery_baseline`. Combatant still owns only
turn budgets and movement. Legacy null lifecycle projects a compatible initial state;
new HP/lifecycle operations persist it. Nothing relies on React counters.

`LifeCycle` is the shared transition handler used by HP damage/healing, GM HP setters,
Character/Token editing, death saves and corrections. It creates the existing canonical
Unconscious condition with lifecycle provenance, ends concentration, and removes only
its own Unconscious instance after recovery. Prone remains. It does not delete actors.
Actions, items, spells, object interactions, looting and normal movement enforce
incapacitation/death; GM can still edit scene representation explicitly.

`POST /api/scenes/{scene}/adventuring` accepts intent only. It runs under the existing
campaign → scene locks and `SceneTransaction`. All participants validate before rest
recovery; any failure rolls back the entire party. Existing recipient-filtered events
and Character rosters reconstruct state after reconnect. The transport UUID receipt
is complemented by durable `lifecycle_commands` records with canonical fingerprints,
current authorization on replay and GM-only session history. Retried death saves, rests,
die spending and corrections cannot apply twice, including after receipt cleanup.
Player HTTP responses are separately redacted. NPC consequences remain GM-only.

## Verified rules

| Local SRD pages | Implemented behavior |
| --- | --- |
| 17–18 | At 0 HP a character becomes Unconscious/dying unless instantly dead. Each required turn rolls a server d20, without an ability or proficiency. 10+ succeeds, otherwise fails. Three successes stabilize; three failures kill. Natural 1 causes two failures; natural 20 restores 1 HP. Stabilization and any HP regained reset both counters. |
| 17–18 | Damage at 0 causes one failure, or two for a Critical Hit, even when Temporary HP absorbs it. Damage at least equal to max HP at 0 is lethal. On dropping from positive HP, damage remaining after Temporary HP and current HP is lethal when at least max HP. Max HP reaching 0 also kills, with a distinct cause. |
| 18 | Stable stays at 0 HP, remains Unconscious, and makes no death saves. Damage destabilizes it and adds the applicable failures. The server rolls 1d4 recovery hours; GM confirms that fictional time passed before restoring 1 HP. No real timer substitutes for this. A zero-effect HP correction does not destabilize it. |
| 18 | Help/stabilize uses the existing Medicine check and condition/roll context, DC 10; it spends Action in combat and requires adjacency (5 ft). Success stabilizes. Healing spells, potions and GM healing share the HP handler; ordinary healing cannot restore a dead creature. |
| 17 | GM's explicit knockout correction represents a qualifying melee attack: 1 HP, Unconscious, ending on regained HP, successful first aid (Medicine DC 10), or confirmed Short Rest. It is a logged adjudication, not an inferred nonlethal attack toggle. |
| 18 | Temporary HP absorbs first, is not healing, does not wake a creature at 0, does not add together, and ends at Long Rest. Existing grants retain the larger pool. |
| 187 | Short Rest represents at least one hour of light downtime and requires at least 1 HP to start. A spent Hit Point Die heals `max(1, roll + Constitution modifier)`, capped at max HP. Dice are spent one at a time; the next die is a separate decision. |
| 185 | Long Rest represents at least 8 hours, including at least 6 sleeping and at most 2 light activity; requires 1+ HP to start and a 16-hour wait after the previous Long Rest before starting another. Recovery restores all HP and **all** spent Hit Point Dice, recorded max-HP/ability reductions, eligible resources, and removes exactly one Exhaustion level. |
| 180–181 | Exhaustion 0–6 is persistent. Every D20 Test loses `2 × level`; speed loses `5 × level` ft, floored at 0. Six levels cause death through the shared lifecycle. This affects checks, attacks, saves and death saves, not damage, Constitution healing modifiers or spell save DC. |

Death saves become required at the start of the actor's turn and resolve at most once
on that turn. GM may explicitly attest another death-save turn outside active combat;
Players cannot manufacture such turns. GM retains turn navigation for adjudication.
Save-wide managed bonuses can affect death saves; ability-linked bonuses do not.
Natural 1/20 retain their special outcomes regardless of total modifiers.

## NPC policy and prepared consequences

`combat_profile.zero_hp_policy` is `immediate_death` (ordinary NPC default per p.17),
`death_saves`, or `manual` (defeated, awaiting GM outcome). No Character is fabricated
for an independent NPC. Dead, defeated and unconscious remain distinguishable;
corpse-container availability follows incapacitated lifecycle rather than assuming
every 0 HP means dead. A knocked-out NPC at 1 HP can be looted if a container exists.

GM can prepare up to six `lifecycle_consequences` with name, trigger (`on_zero_hp`,
`on_defeat`, `on_death`), description and reference. `NpcConsequences` bridges a real
transition into the existing durable AbilityExecution/GMResolutions queue. Repeated
damage to an already dead NPC does not create another consequence. The source scene
receives the task; mirrored Character representations do not duplicate it elsewhere.
An unconscious defeat at 1 HP does not fire `on_zero_hp` or `on_death`.

This slice deliberately routes all such prepared prose to ManualResolution. It does
not parse text or claim an unreviewed automatic AoE mapping. The existing queue lets
GM choose affected tokens, use HP/conditions, record a note and close the task without
opening an NPC editor. The generic bridge contains no Magmin/Death Burst special case.
Townhouse's existing Magmin supplies that representative prepared consequence from
the campaign data, with canonical SRD p.305 reference (DEX 11, 10-ft Emanation,
2d6 Fire, half on success). GM adjudicates targets and effects.

## Rest UI and recovery policy

GM Session/Combat Console has compact Short/Long Rest controls for the party or
selected player Characters. The confirmation names participants and the canonical
period/restrictions. Active combat blocks normal rest, including combat in another
scene involving a participant. Explicit GM-only combat override is persisted and
logged. Dice can be configured in the GM runtime controls or selected Token Inspector:
up to four pools `{die: d6|d8|d10|d12, max, current}`. No class/level inference occurs.

GM confirmation resolves the completed rest period immediately. A Short Rest then
opens a persistent die-spending window in each Player HUD, showing HP, available
die buttons, rolled die, CON, actual healing and a finish action. Reload resumes that
window. The die/rest ID prevents a stale command from spending in a later rest.
Damage, initiative beginning and leveled spellcasting close an unused spending window.
Already applied recovery belongs to a previously confirmed completed period; it is
not rolled back as if a real hour-long timer had been running.

Resources have `recovery = manual | short_rest | long_rest`; existing resources
default to manual. Long Rest also restores short-rest resources. Normal spell slots
explicitly default to `long_rest`, with a GM-configurable manual policy. The generic
service restores current to existing maximum; it invents no item charges. Abilities
already spend Character resources, so they inherit the configured policy. Items
currently use quantities/consumables; those are not replenished by resting.

Long Rest summary contains only actual changes. Short Rest completion history records
spent dice and actual recovered HP. GM lifecycle controls also expose Stable, revival/
HP, death-save reset, Exhaustion and explicit NPC outcomes. Every command is authorized,
durable, logged and realtime. Revival is a GM correction, not a resurrection-spell engine.

## Effects and manual boundaries

Known finite managed spell durations affecting a resting participant/caster advance
once per party by the confirmed minimum period (1h or 8h). Expired effects end via the
existing cleanup; longer effects keep the remainder. Indefinite/until-dispelled effects
and unrelated conditions remain. Long Rest sleep ends the resting caster's concentration.
Combat ending now preserves `until_removed` conditions instead of blanket cleanup.

The small `reduction` GM command records normal max HP/ability scores before explicitly
applying a recoverable reduction; Long Rest restores that baseline. Existing arbitrary
manual edits cannot reveal an unknown original value, and special prose exceptions
require GM adjudication. No automatic monster-text reduction parser was added.

GM confirms sleep/light activity, world-time eligibility, all interruptions and any
special recovery restrictions (for example a hazard's exhaustion restriction).
Short Rest interruptions are initiative, non-cantrip casting and any damage.
Long Rest adds one hour of walking/physical exertion; at least one prior hour gives
Short Rest benefits on interruption, and resuming adds one hour per interruption.
There is no pending hour/eight-hour simulation, fictional date or wall-clock lockout.
Extended durations beyond the guaranteed minimum, effects with no trusted duration,
nonparticipating campaign locations and special exceptions remain GM adjudication.
Stable recovery similarly requires confirmation of the persisted 1d4 hours.

## Validation

Uses only native Windows PHP/Node and isolated SQLite tests; no Docker workflow.
Live acceptance reuses Townhouse campaign 5 / scene 5 / session 1, the existing GM
and two Players. `php artisan qa:townhouse` now restores lifecycle, Exhaustion,
die pools, rest/baseline, resources and the prepared Magmin consequence without
changing map composition or creating accounts/campaigns/scenes/sessions.

Final checks:

- Backend: **279 tests / 3934 assertions**, passed in isolated SQLite. Includes 26
  lifecycle tests and end-to-end healing spell/potion regressions. Natural 1/20,
  lethal thresholds, Stable, resource policy, multi-pool dice, UUID receipt cleanup,
  authorization/revocation, party rollback, finite/indefinite effects and source-scene
  NPC consequence scope are covered.
- Frontend: **210 tests / 44 files**, passed. Eight new lifecycle/rest tests cover
  the downed controls, Stable/dead display, Exhaustion mechanics, dice pools, summaries,
  GM controls and realtime reconstruction. TypeScript, ESLint, production Vite build,
  changed-file Pint and `git diff --check` passed. Vite retains its large dice chunk notice.
- Native doctor: **9 OK / 2 warnings**: optional Redis is absent; the nightly FFprobe
  version string is outside the doctor's recognized stable-version format. PHP, MySQL,
  queue storage, private assets, Reverb configuration and scheduler heartbeat pass.
  Actual Reverb delivery was also exercised by three isolated browser contexts.
- Chromium desktop 1440×1000 and Player 390×844: dying HUD, Death Save, GM Stable,
  healing, map-first Player Help/Medicine, two die spends, Short Rest completion,
  Exhaustion, Long Rest and NPC queue passed. A real Medicine failure (1 + 1 = 2)
  followed by success (18 + 1 = 19) used the existing Check engine without a Character
  window. Final death save was 14, a success. Backend tests separately force all
  natural-roll edge cases; no production dice-control endpoint was added.
- Reconnect preserved death-save progression, Stable, the open Short Rest window,
  two spent dice, post-Long-Rest slots/HP and Exhaustion. Long Rest restored Kern to
  48 HP and six d10, Lyra to four level-I slots, and changed Exhaustion 3 → 2.
  The Magmin consequence entered the existing queue, displayed its copied text and
  p.305 reference, and was closed without navigating to an NPC editor. No creature
  was within its 10-ft Emanation in this prepared map layout, so no extra damage was
  needed for that manual acknowledgement. JavaScript errors: **0**; mobile page width
  stayed 390/390. Physical devices, Firefox/Safari and WAN remain unverified.
- After final reset and native process restart: **3 users / 1 campaign / 1 scene /
  1 game session / 6 Characters / 7 Tokens / 5 Props**, one preparing combat with six
  combatants, zero conditions and zero pending tasks. Kern 48/48, Lyra 40/40,
  Exhaustion 0, full dice and null rest state; both original positions restored.

Ignored evidence: `artifacts/task32-adventuring/` (acceptance JSON, screenshots,
clean-state/browser JSON, doctor and server profile), plus `artifacts/lifecycle-*.txt`.

### Performance limits

Three rollback-contained native server samples per path, excluding network and
post-commit broadcast: damage → 0 HP **118–153 ms**, Death Save **135–144 ms**,
Next Turn → dying actor **170–193 ms / 214 SQL**, party Short Rest **127–129 ms**,
party Long Rest **133–135 ms**. These are small, warm samples, not a production p95.
No broad optimizer/cache rewrite was introduced. The previous Task 31 report used
another runtime; it is not a paired timing baseline.

The final three-client browser run had roughly **0.6–2.4 s HTTP** for new operations,
including native development-server queues, asset/reload traffic and broadcasts.
Functional/realtime agreement passed, but this is a material local responsiveness
limit, not a claim that end-user requests finish in the sub-200-ms domain timings.

Next single task: measure and reduce native multiplayer HTTP/broadcast latency under
4–8 clients, retaining this completed adventuring loop as the acceptance workload.

