# Cinematic Player UI — local acceptance, 2026-10-29

## Scope and automated checks

Player presentation changes only; Character/resource/ability execution, hotbar
storage, geometry, Combat, recipient filtering and mutation receipts are retained.
The shared check presenter uses the same physical dice adapter as abilities.
Docker was rebuilt after source changes; MySQL/storage/Redis volumes and keys were
preserved. No host database migration, seed, push or public deployment was performed.

- Isolated Docker PHP suite: **145 tests, 1804 assertions**, passing.
- Frontend: **152 tests across 33 files**, passing, including authoritative dice
  notation validation. Final Docker typecheck, full ESLint and production build pass.
- Pint: **183 files pass**. Docker `tabletop:doctor`: all checks OK.
- Build retains the expected large lazy dice chunk warning (~145 KB gzip). The
  absolute divider asset URL is served from public; its browser request succeeds.

## Real browser acceptance

Chromium, local Docker at `http://localhost:8090`, separate authenticated GM and
Player sessions. QA account was created through normal registration, then joined
through a one-use invitation (revoked after joining). Existing account passwords
and prepared Character ownership were preserved.

Retained local-only QA additions to campaign **21**, scene **58**: Player **32**
(`QA · Cinematic Player`), Characters **4/5**, token **308**. These are test copies
with twelve configured actions and four resource presentations, not application
seeds. Original Character 2/3 configuration was not edited. After testing, the
existing target 302 returned to its pre-test **83 HP**; QA Character 4 returned to
34/41 HP, Mana 10/10, Focus 3/3, Rage 2/3, Ward 24/40. Its full hotbar was restored.

Verified:

- One shared desktop HUD, painted icons, twelve configured slots, empty slot state,
  HP and differently sized resources. HUD contains no Character select.
- Portrait roster switches to Mira's empty independent bar and back to Kern's
  saved layout. Desktop native drag/swap survives reload; Delete clears only a slot;
  the browser assigns the removed action back without executing it.
- Ranged cursor reads **40.2 / 60 ft**. Out-of-range click opens no execution dialog.
  Circle, cone, line and rectangle previews remain map-first; friendly circle
  preview reports **two allies** and gives them distinct affected rings.
- Enemy radial shows a bounded action set, sector highlight, painted attacks and
  generic book art for the configured sign interaction. Escape dismisses menus.
- Real miss, hit, healing and resource spend; visible world responses remain bounded.
  A hit with server d20s **[11,18]** and d8 **[1]** displayed exactly those physical
  faces, resolved 18 + 5 = 23, and applied 3 damage. GM snapshot reflected accepted HP.
  A final framing pass fits the resting dice group to its stage; the compact d8
  damage stage was rechecked with face 4 and 6 total damage, without edge clipping.
  A healing action applied +6 HP and spent one Focus. Temporary HP/resource changes
  were restored after these checks.
- Advantage **[2,11]** displayed both dice, marked 2 discarded and resolved
  **11 + 3 = 14**. The server DC and modifier are visible beside the physical stage.
- Boundary probes of the 3D adapter cover d4/d6/d8/d10/d12/d20 and natural 1/20.
  They exposed upstream pre-simulation drift and stale d4 samples. Sampling the
  final orientation before remapping corrected d4 cases [1,4], [2,3], [4,1].
- Reduced motion creates **zero dice canvases**, displays server values and sends
  **one** gameplay command. Aborting the lazy dice module also reaches the static
  result and enabled Continue button with **one** command, without a gameplay retry.
- **390 × 844**, Chromium mobile/touch emulation: no horizontal document overflow;
  portrait roster, bounded browser (top ~105, height ~440), physical check outcome,
  long-press enemy radial. Hold/drag between slots 1 and 12 survives reload and
  launches no ability; reverse swap restores the layout. Resource cost artwork
  remains 13px inside browser cards after the mobile visual correction.

## Screenshots

Ignored evidence under `artifacts/`:

- `cinematic-desktop.png`, `cinematic-switcher.png`, `cinematic-ability-browser.png`
- `cinematic-ranged-targeting.png`, `cinematic-out-of-range.png`
- `cinematic-circle-aoe.png`, `cinematic-friendly-aoe.png`, `cinematic-cone-aoe.png`
- `cinematic-line-aoe.png`, `cinematic-rectangle-aoe.png`, `cinematic-enemy-radial.png`
- `cinematic-dice-advantage.png`, `cinematic-attack-damage.png`
- `cinematic-world-feedback.png`, `cinematic-healing.png`
- `cinematic-reduced-motion.png`, `cinematic-dice-fallback.png`
- `cinematic-mobile.png`, `cinematic-mobile-browser.png`, `cinematic-mobile-switcher.png`
- `cinematic-mobile-drag.png`, `cinematic-mobile-radial.png`, `cinematic-mobile-dice.png`

## Remaining concerns

Physical phones/tablets, Safari/Firefox, weak mobile GPUs and a multi-hour soak
remain unverified. The dice library exposes no destroy API, so the adapter owns
resize and GPU cleanup; extended repeated-roll memory profiling remains useful.
At phone widths the complete twelve-slot HUD occupies about 280px vertically.
Initial Fit still shows the entire scene; existing zoom/pan controls provide a
closer view. Campaign-provided portraits/maps determine the final content quality.
