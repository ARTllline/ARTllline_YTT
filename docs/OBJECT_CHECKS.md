# Object interaction checks

An object action may require a server roll before resolving its result. Existing
actions without a check retain their Handout/Cue behavior. No character sheet or
rules engine is introduced.

## GM preparation

Open the token/prop Inspector → Взаимодействия → Требуется проверка. Configure a
free-text check label, optional ability key, DC (1–100), fixed modifier (−100–100),
retry policy, and separate success/failure results. Each branch supports Nothing,
Show Handout, or Run Cue. DC is secret by default; visibility and the ability key
are under Дополнительно. The key is metadata, not a lookup into character stats.

Player radial actions open a focused d20 presentation. The server rolls only when
the Player presses Бросить. The final die, modifier, total, and outcome come from
the response. Natural 1/20 receive distinct presentation; success always means
`natural + modifier >= DC`, without automatic critical rules. Reduced motion
removes die animation and all presentation delays. A resulting Handout waits
behind the check until the Player dismisses the outcome.

## Authority and privacy

The command contains the object/action IDs, active-scene epoch, mutation UUID, and
optionally an owned actor token ID. DC, modifier, branches, and policy come only
from the stored GM configuration. Forged configuration is rejected or excluded
from validated command data. Both branches must point to the same campaign
(Handout) or exact scene (Cue), and the action author must still have GM access.
Hidden objects, inactive scenes, stale epochs, and non-members cannot run checks.

The actor is the authenticated invoking user. An explicit token must belong to
that user in the same scene and be visible. Without one, the server associates the
single visible owned token, if unambiguous; otherwise it records the Player alone.
The interacted object is not treated as the actor. An owned token's locked position
does not prevent its owner from being associated with a check.

Player object DTOs expose only `enabled`, `label`, and explicitly visible DC for
checks. Modifier and retry policy are absent before rolling. The accepted result
reveals the arithmetic but no secret DC, targets, or branch configuration.
`check.resolved` is sent after commit only to the authorized scene GM channel.
The invoking Player receives their safe result by HTTP; other Players receive no
roll details. Existing Cue effects may affect the group, as configured by the GM.
Handouts reuse the existing selective reveal executor.

## Transactions, repeats, and history

`scene.interact` uses the existing idempotent mutation middleware. Its campaign
writer lock serializes concurrent commands; receipt reservation, check history,
Handout access/Cue run, and queued Cue job commit together. `random_int(1, 20)` is
called inside that transaction. Replaying the same mutation UUID returns its
original receipt and never executes the branch again. Existing Cue worker guards
prevent job redelivery from repeating a committed step; Cue jobs never roll dice.

- Once: one result per scene/object/action for the whole group. Its original
  actor can inspect the saved result; other Players receive a generic conflict.
- Once per Player: each Player has one independent result. A new UUID from that
  same Player returns their previous result without executing the branch again.
- Repeatable: each new UUID can roll; retrying a UUID replays its original result.

Action identity is stable when editing/reordering. Changing DC, modifier, branches,
or label does not reset consumed attempts. A genuinely new action UUID has its own
history. GM invocations use the same policy and record the GM as actor.

The client synchronously guards the roll button and retains ambiguous UUIDs in
sessionStorage, scoped to user/scene/epoch/object/action. A lost response followed
by reconnect or page reload can be retried with the original UUID. Reconnecting
does not automatically roll. When browser storage is unavailable, recovery is
limited to the current page's retained request identity.

`object_checks` preserves actor, optional token, action identity/label, natural die,
modifier, total, outcome, timestamp, and private DC/selected branch. A unique
user/mutation key also protects original rolls if a transport receipt is removed.
Do not prune receipts or check history casually: retry policies depend on history,
and transport receipts preserve aliases when a new UUID reuses an earlier result.
GM-only `GET /api/scenes/{scene}/object-checks?kind=token|prop&id=...` returns the
20 most recent results. Inspector history refreshes while expanded.

## Before character stats

Resolve future modifiers from authoritative Player/token data, not submitted
totals or skill names. Keep actor selection explicit when several owned tokens
exist. Snapshot the resolved modifier and its provenance on the check so later
stat edits cannot change an accepted roll. Preserve the transaction/receipt and
recipient-specific projection boundaries; no client character sheet may bypass
them. V1 has one fixed action modifier and no advantage, resources, or formulas.

## Verification

Backend tests cover secure d20 range, deterministic arithmetic, UUID replay,
reconnect-style resubmission, repeat policies, both result branches, natural 1/20,
secret DTO/event isolation, cross-campaign access, actor ownership, and GM-only
history. Frontend tests cover retained identities and reduced-motion timing.

The local Docker browser workflow exercises GM and two independent Players,
real Reverb/Cue execution, double click, concurrent MySQL requests, failure
Handout, and a committed response deliberately dropped before reload/retry.
Local ignored screenshots and browser evidence: `artifacts/object-checks/`.

Verified on 2026-10-29: 113 backend tests / 1474 assertions and 135 frontend
tests / 29 files passed. Typecheck, lint, production build, changed-file Pint,
and Prettier checks passed. Browser checks also confirmed concurrent distinct
UUIDs cannot bypass Once per Player, actual GM-only Reverb delivery, and the
390 px Player layout. Temporary campaigns/accounts created by these checks were
removed after validating their exact IDs and membership; prepared data was kept.
