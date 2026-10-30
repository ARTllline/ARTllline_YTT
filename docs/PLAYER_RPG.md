> Historical validation used the former container runtime. Current local commands: [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md); data migration: [LOCAL_MIGRATION.md](LOCAL_MIGRATION.md).

# Player RPG layer — 2026-10-29

## Use

GM: **Добавить → Персонажи → Настроить персонажа**. Configure resources, named
modifiers, defense/speed and abilities in the compact editor. Resources have a
stable internal key, label, current/maximum, icon, accent, order and an explicit
permission for player adjustment. Charges can use the same resource mechanism.

Abilities use editable Attack, Check, Healing and Utility presets. Choose a target,
modifier, optional resource costs, small damage expression and a result. Cue
options show their scene; a Cue can run only on its own scene. Handouts use the
existing selective reveal path. Saving rejects broken resource/result references.

Player: the bottom HUD combines portrait, identity, HP, resource rail and hotbar.
Click the portrait to switch between owned heroes when there is more than one;
click the name for HP, resources, AC/speed, conditions, modifiers and abilities. Click an
action icon (or keys **1–8** outside text fields/dialogs), choose a highlighted
world target to execute. **Escape/right click** cancels targeting; **Tab/arrows +
Enter** provide keyboard targeting without a target select. The twelve hotbar slots
have persistent Player/Character layouts; the ability browser restores or assigns
actions. See [PLAYER_TACTICS.md](PLAYER_TACTICS.md) for range, area, visual authoring
and the current QA scenario. Touch uses the same action bar
and preserves long-press object menus. Owned character radial menus open abilities
or character details without copying the action bar.

An ambiguous network response keeps its original command, target, roll mode, scene
epoch and UUID in session storage. After reload, use **Восстановить ответ**. Do not
create a new action to retry an unconfirmed one. Private/disabled browser storage
limits recovery to the current mounted dialog; server idempotency remains intact.

## Implementation boundaries

- `Character` owns persistent HP, AC, speed, named modifiers, resources and abilities.
  Linked tokens delegate these fields; standalone tokens/NPCs keep their old data.
  The additive migration takes AC/speed from the oldest existing representation.
  Transforms, visibility and existing conditions remain scene/token state.
- Abilities are bounded, campaign-scoped Character configuration, not a spell list
  or rules engine. A player receives enabled action summaries and their own costs;
  private DC/defense and result target configuration are omitted.
- Both object checks and abilities use `CheckRoller` and `TokenCheckStats`. Normal,
  advantage and disadvantage retain the existing d20 behavior. Natural 1/20 receive
  visual treatment and no automatic critical mechanics.
- Damage accepts 1–20 dice of d4/d6/d8/d10/d12/d20 and an optional signed modifier
  up to 99. `TokenCombatActions::adjustHp` is the single bounded HP adjustment path
  for Combat, damage and healing, including persistent linked characters.
- Execution locks campaign then scene and uses the existing mutation receipt
  middleware. Resource validation, authoritative dice, HP, Cue/Handout acceptance
  and durable execution record commit together. A rejected result rolls back the
  action. Accepted asynchronous Cues retain the existing queue/retry semantics.
- `ability_executions` retains actor, ability, request context, raw check/damage
  dice, totals and UUID after transient receipt cleanup. Reusing an accepted UUID
  never rerolls or reapplies costs/results. Replay checks current campaign access
  and Character ownership. The ledger currently has no automatic retention job.
- Target IDs are resolved only in the active authorized scene. Hidden entities,
  foreign IDs, stale epochs, other owners and insufficient resources are rejected.
  Self/no-target abilities can operate without a scene representation. Spatial
  targets require the character's non-hidden token on that scene.
- Realtime uses recipient-specific existing projections. Only visible target
  feedback (`−N`, `+N`, `Промах`) is shared. Private resources/configuration remain
  owner/GM data. Pixi targeting, rings and floating text are transient presentation.

## Validation evidence

The normal Docker image was rebuilt, and the additive migration applied to the
local test copy. Existing volumes and keys were preserved. Automated suites use
the disposable SQLite/storage environment from `scripts/docker.ps1 test`.
Final run: **141 PHP tests / 1764 assertions**, **146 frontend tests / 31 files**.
Typecheck, ESLint, Docker production frontend build, Pint and Docker doctor passed.

Backend coverage includes resources, authoring references, ownership/revocation,
visible/hidden/foreign targets, point bounds, attack defense, authoritative modifiers,
damage, healing, costs, rollback, receipt/durable idempotency, Cue exactly-once
acceptance, selective Handouts and private snapshot/realtime configuration.
Frontend coverage includes affordability and immutable pending command recovery;
existing checks, scene, combat, radial and realtime suites remain part of the run.

Browser checks used separate GM and Player sessions on `http://localhost:8090`:

- Desktop HUD, two resources, tooltips, compact character panel, public conditions,
  private-condition filtering, active Character switching, keyboard action/cancel.
- Token targeting through canvas and accessible selector; check with advantage,
  attack hit/miss, server damage dice, resource spend, healing and world feedback.
- Accepted-response loss followed by reload/recovery preserved the exact roll/UUID.
  A fire attack spent Mana 5 → 3 and damaged the target 18 → 10; recovery left both
  values unchanged. A live Player heal appeared in the GM Combat panel within
  136 ms in the observed local run (one observation, not a latency benchmark).
- Ability Cue result completed through the worker, and ability Handout result used
  the existing reveal/viewer. Reduced-motion check presentation was also exercised.
- GM resource/ability editor and a real save; Character identity/resources remained
  available on a second scene without its token, including a no-target check.
- Chromium touch emulation at **390 × 844**: HUD/action bar, token drag (accepted
  snapped move; original placement restored), long press radial,
  ability target tap and existing object check → selectively revealed Handout.
  No horizontal document overflow in the inspected player states.

The retained local QA campaign is **QA · RPG Player Layer** (`21`), main scene `58`,
second scene `59`, Character **Керн** (`2`) and **Мира** (`3`). Kern's prepared loop:
34/41 HP, Mana 6/10, Focus 3/3; Perception +3, Strength +5, Magic +4; sword attack
1d8+3, fire attack 2d6 costing 2 Mana, Perception check and self-heal costing 1 Focus.
The main QA values were restored after validation; subsequent play will change them.
These are local QA records, not application seeds or a deployment.

Screenshots are ignored evidence in `artifacts/task18-*.png`, including desktop,
mobile, targeting, check/attack outcomes, Character panel, GM editors and touch radial.

## Remaining validation

Physical touch devices, Safari/Firefox, external WAN/production deployment and a
multi-hour session soak remain unverified. The browser tests above use Chromium
emulation. Existing manual fog/visibility contracts are preserved; this adds no LOS,
range adjudication, turn economy, cooldowns, character builder or scripting.
