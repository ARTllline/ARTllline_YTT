# V1 release gate

See VALIDATION.md for the dated local evidence. A checkbox below is an operator
action on the actual release host; supplied configuration alone does not satisfy it.

## Before the first public session

- [ ] Locked dependencies, built assets, tests/lint/typecheck/Pint/Composer checks pass.
- [ ] Dedicated MySQL; existing APP_KEY preserved; private storage outside web root.
- [ ] APP_DEBUG=false, HTTPS certificate renewal, Secure cookies, exact Reverb origin.
- [ ] `nginx -t`; PHP-FPM 64M upload / 68M POST / 256M memory; Nginx 68M body limit.
- [ ] `tabletop:doctor --production` has no errors; review every warning in context.
- [ ] Redis PING/cache/session, FFprobe, file permissions and free disk space checked.
- [ ] External browser WSS subscriptions and signed publication reach Reverb.
- [ ] Queue and Reverb restart after termination; scheduler timer runs each minute.
- [ ] Reboot the release host and repeat join, move, Cue and scheduler checks.
- [ ] Upload map/audio/handout; inspect actual FPM limits and large-file errors.
- [ ] Consistent backup copied to a second protected location; restore into fresh DB
      and storage; compare snapshot and asset hashes, preserve the matching APP_KEY.
- [ ] Repeat a complete session with real participants, devices and WAN connections.
- [ ] Safari on macOS/iPad: resize/orientation, drag, fog, audio gesture, private media,
      reconnect. Also latest supported Chromium/Firefox and narrow Player layout.
- [ ] Multi-hour GPU/realtime soak on intended hardware; compare memory after GC,
      textures/listeners and frame-time tails, not just an average FPS.

## Session rehearsal

Create/activate scene → join invite → move assigned tokens → hide/reveal → manual
fog/ruler/AoE/ping → select/move group → Undo/Redo → selective handout/revoke →
encounter/initiative/HP/conditions → region entry/event → audio/camera → preloading
without activation → next scene → finish Session while keeping scene/combat state.

Include 350–1000 ms latency, disconnect/reconnect, accepted response loss + Retry,
worker interruption, failed Cue step + repair + Retry, and browser reload mid-run.
Verify private snapshots/broadcasts/URLs, cross-campaign denial and former-recipient
revocation. Do not use production campaigns for destructive tests.

## Maintenance / rollback

- [ ] Dry-run receipt/execution retention; preserve failed runs for repair.
- [ ] Logs rotate and contain no credentials, private filenames or Cue content.
- [ ] Keep previous release and verified recovery set; establish a maintenance window.
- [ ] Stop all writers before restoring/repointing DB and files; never blindly roll
      migrations backward or regenerate APP_KEY.

Current disposition: local V1 candidate. Public production readiness is conditional
on the unchecked host/device checks above; no VPS deployment was performed in Task 12.
