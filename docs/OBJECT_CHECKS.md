> Historical validation used the former container runtime. Current local commands: [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md); data migration: [LOCAL_MIGRATION.md](LOCAL_MIGRATION.md).

# Object checks and acting characters

Checks use authoritative Token modifiers. This is a minimal, system-agnostic
foundation, without attributes, proficiency calculations or a character sheet.

## GM preparation

Token Inspector → **Модификаторы проверок** provides a stable internal key,
editable Russian label and integer modifier (−100…100). Quick presets include
`perception`, `strength`, `dexterity`, and `magic`. Custom keys start with a lowercase
ASCII letter and contain lowercase letters, digits and underscores (48 characters
maximum). Keys cannot be renamed in place. Each Token supports up to 30 rows.

Object Inspector → **Взаимодействия → Требуется проверка** stores `stat_key`, label,
DC, visibility, retry policy, and success/failure branches. New checks default to
`perception` and do not store the character modifier. Missing stats produce an
explanation instead of assuming zero. Configure the key on each character before
play. Branch targets must belong to the same campaign (Handout) or exact scene (Cue).

## Player workflow

Player View shows **ДЕЙСТВУЕТ** with a portrait and character selector independent
of canvas selection. One visible controlled Token is automatic; several require
an explicit choice. Hidden, deleted and reassigned Tokens stop being eligible.
A movement lock does not prevent an owner from making a check.

Radial checks show the actor, check name, modifier source and roll mode: Обычный,
С преимуществом, С помехой. Commands send `actorTokenId` and `rollMode`. Only pressing
Бросить rolls dice. Normal rolls one d20; advantage/disadvantage roll two and use
the maximum/minimum (ties select the first). Both raw dice and the used die are
shown. Natural 1/20 have no automatic success/failure rules.

The preview comes from the authorized snapshot; the server resolves it again
inside the transaction. Results show the original character/source even when a
Once per Player policy returns an earlier character's result. Handouts wait behind
the presentation until dismissal. Reduced motion removes animation delays.

## Authority and privacy

An explicit actor must be a visible Token in the current scene controlled by the
Player; GM may use any visible Token. New stat checks require the actor ID, including
automatically selected sole actors. Authorization runs again on receipt replay.
Submitted modifiers, DC, branches and targets cannot override stored configuration.
Inactive scenes, stale epochs, hidden objects and non-members remain rejected.

Only GM and the Token controller receive `checkStats`, through snapshots and
incremental realtime events. Public action DTOs contain action ID, label/icon,
check label, stat key and explicitly public DC. Secret DC, branches, targets and
retry policy stay private. HTTP results contain safe arithmetic/provenance.
`check.resolved` still goes only to the scene GM channel, after commit. Other
Players receive no roll details.

## History, transactions and retries

The existing campaign writer lock, receipts and transaction boundaries are
retained. Roll history, receipt, Handout access/Cue run and queued Cue job commit
together. Cue workers never reroll checks.

History snapshots Token ID/name, stat key/label, base modifier, other modifiers
(currently an empty list), final modifier and source kind. It also stores raw dice,
mode, selected natural die, total, outcome and private DC/branch. Later stat edits
do not change accepted rolls. GM-only history shows the latest 20 object checks.

- Once: one result per object/action for the group; another Player gets a generic conflict.
- Once per Player: one result per authenticated Player, **not per character**.
- Repeatable: each new UUID can roll; replaying a UUID returns the saved result.

Changing actor/mode with the same UUID is a conflict. SessionStorage retains the
original UUID, actor and mode across lost responses/reload. Ambiguous requests pin
those controls until a server answer. Reconnection does not automatically roll.
When browser storage is unavailable, recovery is limited to the current dialog's
in-memory request. Do not casually prune receipts/history: policy and aliases
depend on them. Durable roll identity also checks actor/mode after receipt removal.

## Task 16B compatibility

The additive migration adds nullable stats/provenance/dice without rewriting old
actions/history. Checks without `stat_key` retain their fixed modifier, optional
single-owned-Token association, retry policy and effects. GM sees the legacy source
and can convert an action by entering a stat key. Conversion does not reset attempts
or change old results. Historical rolls project as normal one-die rolls with
`legacy_interaction` provenance. The frontend also accepts old receipt shapes.

## Before Player Game Layer

Stats belong to individual scene Tokens. Decide how persistent character identity
maps to these Tokens before adding shared cross-scene data. Copies are independent.
Keep retry policies scoped to Players unless per-actor attempts become an explicit
product decision. Additional modifiers, resources and character data must preserve
server authority and the existing transaction/projection boundaries.

## Verification scope

Tests cover automatic/explicit actor selection, independence from canvas selection,
different stat totals, missing/forged/hidden/cross-scene actors, GM-only edits,
owner-only DTO/events, both two-die modes, immutable provenance, UUID replay,
retained actor/mode, private DC and existing Task 16B branches/policies.

2026-10-29 implementation check: 141 frontend tests, typecheck, ESLint, production build and changed-file Pint passed.
The restricted Windows runtime needs `preserveSymlinks` and a workspace-local
TEMP for Vitest; its ignored verification configuration is in
`artifacts/acting-token/`. At that time backend/browser verification required rebuilding Docker;
automatic approval review was unavailable (model capacity), so these checks and
the new migration have not yet run in Docker. Screenshot capture was also blocked by the browser approval review (model capacity); no screenshot is claimed. Do not treat this as deployment approval.
