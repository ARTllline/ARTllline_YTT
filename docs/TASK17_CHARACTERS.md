# Persistent Characters — 2026-10-29

## Model and migration

`characters` belongs to a campaign and owns name, portrait, player assignment,
kind/disposition, named check modifiers and current/maximum HP. `tokens.character_id`
is nullable, with a database unique constraint on `(scene_id, character_id)`.
`campaign_members.active_character_id` stores each player's choice independently.

The additive migration performs no backfill or name matching. Existing tokens,
including earlier player tokens and NPCs, remain standalone. No prepared content
is converted implicitly. Removing a scene representation does not remove Character.
The API currently does not delete Character records.

## Authority and gameplay

New player-character tokens created through Creation Hub create a Character in the
same transaction. Creation Hub's campaign list places that Character in another
scene. Placing an existing Character ignores submitted identity/HP overrides.
Duplicate representations in one scene are rejected, including selection duplicate.

Linked token reads resolve persistent fields through Character. The old token
columns remain for standalone compatibility, and are not another HP authority.
Existing token Inspector and Combat HP actions write through to Character under
the existing campaign-first transaction lock. HP deltas clamp to 0..max HP and
retain the existing command receipt behavior. Other scenes receive safe incremental
token and roster projections with their own scene revisions.

Coordinates, rotation, scale, size, hidden/locked state, scene relation and object
interactions remain on Token. AC, speed and conditions also remain per-token for
this slice. This is intentionally a minimal persistent HP strategy, not a sheet.

The server validates campaign membership, owner assignment and portrait campaign.
Players can list/select only assigned Characters. Movement and object-check
authorization resolve effective Character ownership, including receipt replay.
Snapshots and realtime events filter private HP/modifiers for other players and
exclude hidden tokens. Assigned Character identity remains available to its owner
even when no scene representation is available. Portrait authorization and asset
usage/preloading account for Character references.

New named checks resolve linked Character modifiers and record immutable Character
and scene-token provenance. Standalone modifiers and fixed 16B checks keep their
previous fallback. Durable roll identity, dice/mode and receipt replay are preserved.

## Player workflow

The persistent selector survives scene changes and reloads. Its actor is the owned,
visible token representing that Character in the current scene; a movement lock
does not prevent checks. If no eligible representation exists, the active scene
token is absent rather than falling back to another character. Older standalone
owned tokens remain available as scene-token actors.

## Verification

- Task 16C baseline first: migration `200000_add_token_check_stats` applied;
  119 PHP tests / 1558 assertions and 141 frontend tests passed in Docker.
  Corrected its realtime assertion to inspect `payload.token`, and asserted that
  the other player receives a token event without private modifiers.
- Character slice: 126 PHP tests / 1667 assertions; 143 frontend tests / 30 files.
  Docker frontend typecheck, ESLint and production build passed. Pint and
  `git diff --check` passed.
- Real Chromium GM/Player contexts: Creation Hub creates one Character; campaign
  browser edits modifier to +7 and places a second representation; existing Combat
  action changes HP 34 -> 25; Player follows scene 1 -> scene 2 and reloads with
  the same Character and HP. An empty third scene retains Character selection,
  shows no active token, and survives reload. Moving the second representation
  to x=924 leaves the first at x=750; another off-scene HP action delivers 24/41
  live to the active Player token. Actual realtime updates were observed.
- GM viewport 1440x1000 and Player viewport 390x844: no horizontal overflow;
  inspected Character browser/editor and Player screenshots. Final Player pass
  had zero JavaScript page errors. Docker rebuilds temporarily interrupted HTTP
  and WebSocket connections; clients reconnected after startup. Doctor: all 11 OK.
- Local evidence: ignored `artifacts/task17-final-*.log` and
  `artifacts/task17-character-browser.png`. Temporary QA records are removed.

Before Player Game Layer, decide whether AC/speed/conditions should become
persistent and whether to offer explicit linking of legacy player tokens. No
automatic conversion is provided. Physical devices and public WAN deployment
were not validated by this slice.
