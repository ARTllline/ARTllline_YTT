/* eslint-disable @typescript-eslint/no-require-imports -- Native browser QA on the permanent fixture. */
/* global require, __dirname, process, console, window */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require(
    path.join(
        process.env.USERPROFILE,
        '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
    ),
);
const {
    api,
    login,
    snapshot,
    tabletop,
    mapState,
    subscribed,
    drag,
    sampleToken,
    finishSample,
    base,
    scene,
} = require('./map07a.cjs');
const root = path.resolve(__dirname, '../..'),
    out = path.join(root, 'artifacts/map07c');
fs.mkdirSync(out, { recursive: true });

async function point(page, tokenId, position) {
    const local = await page.evaluate(
        ({ tokenId, position }) => {
            const find = (view) =>
                view.model?.id === tokenId && view.badges
                    ? view
                    : (view.children ?? []).map(find).find(Boolean);
            const token = find(window.tabletopApp.stage);
            if (!token) throw new Error('Token missing in Pixi');
            const p = token.parent.toGlobal(position);
            return { x: p.x, y: p.y };
        },
        { tokenId, position },
    );
    const box = await tabletop(page).boundingBox();
    return { x: box.x + local.x, y: box.y + local.y };
}
async function doubleClick(page, tokenId, from, target) {
    await tabletop(page).waitFor();
    const a = await point(page, tokenId, from),
        b = await point(page, tokenId, target);
    await page.mouse.click(a.x, a.y);
    await page.mouse.dblclick(b.x, b.y, { delay: 70 });
}
async function move(page, tokenId, from, target, status = 200) {
    const pending = page.waitForResponse((r) => r.url().endsWith(`/api/tokens/${tokenId}/move`));
    await doubleClick(page, tokenId, from, target);
    const response = await pending;
    assert.equal(response.status(), status, await response.text());
    return response.json();
}
const wall = (id, a, b) => ({
    id,
    a,
    b,
    thickness: 6,
    materialVersionId: null,
    blocksMovement: true,
    blocksVision: true,
    blocksLight: true,
});
function segments(lines) {
    return {
        vertices: lines.flatMap(([a, b], i) => [
            { id: `a${i}`, ...a },
            { id: `b${i}`, ...b },
        ]),
        edges: lines.map((_, i) => wall(`e${i}`, `a${i}`, `b${i}`)),
        rooms: [],
    };
}

(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const accounts = JSON.parse(
        fs.readFileSync(
            path.join(root, 'artifacts/permanent-playground-20261030/accounts.private.json'),
            'utf8',
        ),
    );
    const report = [],
        errors = [],
        props = [],
        presets = [];
    let gm,
        baseline,
        token,
        structureEdit,
        mapChanged = false,
        combatChanged = false;
    const record = (message) => {
        report.push(message);
        console.log(message);
    };
    try {
        const pages = await Promise.all(
            [1, 2, 8].map((id) =>
                login(
                    browser,
                    accounts.find((a) => a.id === id),
                ),
            ),
        );
        [gm] = pages;
        const [, first, second] = pages;
        pages.forEach((page) => page.on('pageerror', (error) => errors.push(error.message)));
        baseline = await snapshot(gm);
        assert.notEqual(baseline.combat?.status, 'active');
        assert.equal(
            baseline.structure?.graph.edges.length ?? 0,
            0,
            'Use fixture without existing structure',
        );
        token = baseline.tokens.find((t) => t.ownerUserId === '2');
        assert.ok(token);
        if (!baseline.mapWorld) {
            const expected = mapState(baseline);
            await api(gm, scene + '/map-world', 'POST', {
                expected,
                value: { ...expected, enabled: true },
            });
            mapChanged = true;
        }
        await api(gm, scene + '/grid', 'PUT', { ...baseline.grid, snap: false });
        const x = Math.round(baseline.width * 0.5),
            y = Math.round(baseline.height * 0.55);
        const p = (dx, dy = 0) => ({ x: x + dx, y: y + dy });
        const left = p(-230),
            right = p(230);
        const tokenUrl = '/tokens/' + token.id;
        const place = async (position = left, size = 40) => {
            const placed = await api(gm, tokenUrl, 'PATCH', { ...position, size, scale: 1 });
            await Promise.all(
                pages
                    .filter((page) => page.url().includes('/campaigns/'))
                    .map((page) =>
                        page.waitForFunction(
                            (id) => window.movementFrames.some((raw) => raw.includes(id)),
                            placed.mutationId,
                        ),
                    ),
            );
            // Wait for all subscribed renderers to receive the new canonical origin.
            await Promise.all(
                pages
                    .filter((page) => page.url().includes('/campaigns/'))
                    .map((page) =>
                        page.waitForFunction(
                            ({ id, x, y }) => {
                                const find = (v) =>
                                    v.model?.id === id && v.badges
                                        ? v
                                        : (v.children ?? []).map(find).find(Boolean);
                                const v = window.tabletopApp && find(window.tabletopApp.stage);
                                return v?.model.x === x && v?.model.y === y;
                            },
                            { id: token.id, ...position },
                        ),
                    ),
            );
        };
        const resetStructure = async () => {
            if (!structureEdit) return;
            await api(gm, scene + '/edit-history', 'POST', {
                changes: [
                    {
                        kind: 'structure',
                        id: '5',
                        expected: structureEdit.after,
                        value: structureEdit.before,
                    },
                ],
            });
            structureEdit = undefined;
        };
        const setGraph = async (graph) => {
            await resetStructure();
            const current = await snapshot(gm);
            const saved = await api(gm, scene + '/structure', 'POST', {
                expected: current.structure.hash,
                value: graph,
            });
            structureEdit = saved.structureEdit;
            await Promise.all(
                pages
                    .filter((page) => page.url().includes('/campaigns/'))
                    .map((page) =>
                        page.waitForFunction(
                            (id) => window.movementFrames.some((raw) => raw.includes(id)),
                            saved.mutationId,
                        ),
                    ),
            );
        };
        await place();
        await Promise.all([
            gm.goto(base + '/campaigns/5/scenes/5?mode=session'),
            first.goto(base + '/campaigns/5/play'),
            second.goto(base + '/campaigns/5/play'),
        ]);
        await Promise.all(pages.map(subscribed));
        await Promise.all(pages.map((page) => tabletop(page).waitFor()));
        await place();
        await setGraph({
            vertices: [p(-60, -120), p(60, -120), p(60, 120), p(-60, 120)].map((v, i) => ({
                id: `v${i}`,
                ...v,
            })),
            edges: [0, 1, 2, 3].map((i) => wall(`w${i}`, `v${i}`, `v${(i + 1) % 4}`)),
            rooms: [],
        });
        await Promise.all(pages.map((page) => sampleToken(page, token.id)));
        const building = await move(first, token.id, left, right);
        assert.ok(building.tokenMovements[0].path.length > 2);
        const frames = await Promise.all(pages.map((page) => finishSample(page, building.token)));
        frames.forEach((samples) =>
            assert.ok(samples.some((v) => v.x > left.x + 1 && v.x < right.x - 1)),
        );
        record(
            'Building: Player route accepted around corners; MAP-07B animation observed by GM + 2 Players',
        );
        await first.screenshot({ path: path.join(out, 'building-player.png') });
        await place(p(0));
        let impossibleMoves = 0;
        const countImpossible = (request) => {
            if (request.url().endsWith(tokenUrl + '/move')) impossibleMoves++;
        };
        first.on('request', countImpossible);
        await doubleClick(first, token.id, p(0), right);
        await first.getByText(/Маршрут (не найден|слишком сложен)/).waitFor();
        assert.equal(impossibleMoves, 0);
        first.off('request', countImpossible);
        await first.keyboard.press('Escape');
        record('Unreachable free destination: visible feedback and no movement request');
        await place();
        const doorGraph = segments([[p(0, -180), p(0, 180)]]);
        doorGraph.openings = [
            {
                id: 'door',
                edgeId: 'e0',
                center: 0.5,
                width: 44,
                type: 'door',
                open: false,
                locked: false,
                hinge: 'a',
                direction: 'left',
                angle: 90,
            },
        ];
        await setGraph(doorGraph);
        const closed = await move(first, token.id, left, right);
        assert.ok(closed.tokenMovements[0].path.length > 2);
        await place();
        const toggled = await api(gm, scene + '/structure', 'POST', {
            expected: (await snapshot(gm)).structure.hash,
            door: { id: 'door', open: true },
        });
        structureEdit.after = toggled.structureEdit.after;
        const open = await move(first, token.id, left, right);
        assert.equal(open.tokenMovements[0].path.length, 2);
        await place(left, 46);
        const wide = await move(first, token.id, left, right);
        assert.ok(wide.tokenMovements[0].path.length > 2);
        record(
            'Doors: closed routes around wall, open narrow aperture passes radius 20, radius 23 detours',
        );
        await resetStructure();
        await place();
        const asset = baseline.props.find((prop) => !prop.isHidden && prop.image?.id)?.image;
        assert.ok(asset, 'Existing prop image needed');
        const preset = await api(gm, '/library/object-presets', 'POST', {
            assetId: asset.id,
            name: 'MAP07C temporary furniture',
            category: 'QA',
            settings: {
                width: 100,
                height: 80,
                pivotX: 0.5,
                pivotY: 0.5,
                scaleX: 1,
                scaleY: 1,
                rotation: 0,
                tags: [],
                collider: {
                    type: 'rectangle',
                    x: 0,
                    y: 0,
                    width: 100,
                    height: 80,
                    blocksMovement: true,
                    blocksVision: false,
                    blocksLight: false,
                },
            },
        });
        presets.push(preset.id);
        for (const [dx, dy, rotation] of [
            [-65, -25, 25],
            [80, 40, -20],
        ]) {
            const placed = await api(gm, scene + '/props', 'POST', {
                action: 'create',
                presetId: preset.id,
                ...p(dx, dy),
                rotation,
            });
            props.push(placed.props[0].id);
        }
        const furniture = await move(first, token.id, left, right);
        assert.ok(furniture.tokenMovements[0].path.length > 2);
        assert.ok(
            (await snapshot(first)).props
                .filter((prop) => props.includes(prop.id))
                .every((prop) => prop.movementObstacle && !prop.collider && !prop.preset),
        );
        record(
            'Furniture: rotated prop silhouettes route correctly without Player preset/vision/light metadata',
        );
        // Unknown geometry is never used to search on behalf of a Player.
        for (const id of props)
            await api(gm, scene + '/props', 'POST', {
                action: 'update',
                id,
                patch: { is_hidden: true, x, y, rotation: 0 },
            });
        await place();
        const rejection = await move(first, token.id, left, right, 422);
        assert.equal(rejection.message, 'Перемещение недоступно.');
        assert.equal(
            (await snapshot(first)).props.filter((prop) => props.includes(prop.id)).length,
            0,
        );
        assert.equal((await snapshot(gm)).tokens.find((t) => t.id === token.id).x, left.x);
        record(
            'Hidden blockers: generic rejection, no coordinates/type, no automatic retry or hidden detour',
        );
        await api(gm, scene + '/selection', 'POST', {
            action: 'delete',
            tokenIds: [],
            propIds: props,
        });
        props.length = 0;
        await setGraph(
            segments(
                Array.from({ length: 4 }, (_, i) => [
                    p(-120 + i * 80, i % 2 ? -200 : -60),
                    p(-120 + i * 80, i % 2 ? 60 : 200),
                ]),
            ),
        );
        await place();
        const long = await move(first, token.id, left, right);
        assert.ok(
            long.tokenMovements[0].path.length >= 4 && long.tokenMovements[0].path.length <= 18,
        );
        record('Long route: multiple turns accepted within existing waypoint limit');
        await resetStructure();
        await place();
        // Exercise the original Drag path after click-to-move.
        await drag(
            first,
            { ...baseline, grid: { ...baseline.grid, snap: false } },
            left,
            p(-150),
            200,
        );
        record('Original Drag remains available after automatic routes');
        await place();
        await move(gm, token.id, left, p(-150));
        await place();
        const secondToken = baseline.tokens.find((t) => t.ownerUserId === '8');
        assert.ok(secondToken);
        await move(second, secondToken.id, secondToken, {
            x: secondToken.x + 45,
            y: secondToken.y,
        });
        await api(gm, '/tokens/' + secondToken.id, 'PATCH', { x: secondToken.x, y: secondToken.y });
        await place();
        record('GM and Player 2 can also issue click-to-move for their accessible token');
        let rulerMoves = 0;
        const countMove = (request) => {
            if (request.url().endsWith(tokenUrl + '/move')) rulerMoves++;
        };
        first.on('request', countMove);
        await first.keyboard.press('KeyR');
        const rulerPoint = await point(first, token.id, right);
        await first.mouse.dblclick(rulerPoint.x, rulerPoint.y);
        await first.keyboard.press('KeyV');
        assert.equal(rulerMoves, 0);
        first.off('request', countMove);
        record('Ruler double-click does not submit token movement');
        // Hold the first receipt after the server accepts it, then replace the destination.
        let releaseReceipt, receiptReady, firstAccepted, latestReady;
        const latestAccepted = new Promise((resolve) => {
            latestReady = resolve;
        });
        const held = new Promise((resolve) => {
            releaseReceipt = resolve;
        });
        const reachedServer = new Promise((resolve) => {
            receiptReady = resolve;
        });
        let repeatedRequests = 0;
        const routePattern = `**/api/tokens/${token.id}/move`;
        await first.route(routePattern, async (route) => {
            const index = ++repeatedRequests;
            const response = await route.fetch();
            assert.equal(response.status(), 200);
            const accepted = await response.json();
            if (index === 1) {
                firstAccepted = accepted;
                receiptReady();
                await held;
            }
            await route.fulfill({ response });
            if (index === 2) latestReady(accepted);
        });
        await doubleClick(first, token.id, left, p(-140));
        await reachedServer;
        const latest = p(-80),
            latestScreen = await point(first, token.id, latest);
        await first.mouse.dblclick(latestScreen.x, latestScreen.y, { delay: 70 });
        await first
            .getByText('Ожидание предыдущего перемещения… · Esc — отмена', { exact: true })
            .waitFor();
        assert.equal(repeatedRequests, 1);
        releaseReceipt();
        const latestMove = await Promise.race([
            latestAccepted,
            first.waitForTimeout(5000).then(() => {
                throw Error('Latest repeated movement was not submitted');
            }),
        ]);
        assert.equal(repeatedRequests, 2);
        assert.deepEqual(latestMove.tokenMovements[0].path[0], {
            x: firstAccepted.token.x,
            y: firstAccepted.token.y,
        });
        assert.ok(Math.hypot(latestMove.token.x - latest.x, latestMove.token.y - latest.y) < 2);
        await first.unroute(routePattern);
        await place();
        record(
            'Repeated click before HTTP receipt waits, then routes the latest destination from the accepted origin',
        );
        const combat = (await snapshot(gm)).combat;
        assert.ok(combat?.status === 'preparing', 'Use existing prepared combat');
        combatChanged = true;
        await api(gm, scene + '/combat/begin', 'POST', { combatId: combat.id });
        const entry = combat.combatants.find((c) => c.tokenId === token.id);
        await api(gm, scene + '/combat/current', 'POST', {
            combatId: combat.id,
            combatantId: entry.id,
        });
        await place();
        await doubleClick(first, token.id, left, p(-110));
        const confirm = first.getByRole('button', { name: 'Подтвердить движение', exact: true });
        await confirm.waitFor();
        assert.equal(await confirm.isEnabled(), true);
        assert.equal((await snapshot(gm)).tokens.find((t) => t.id === token.id).x, left.x);
        await first.screenshot({ path: path.join(out, 'combat-preview-player.png') });
        await first.keyboard.press('Escape');
        assert.equal(await confirm.count(), 0);
        await doubleClick(first, token.id, left, p(-110));
        await confirm.waitFor();
        const accepted = first.waitForResponse((r) => r.url().endsWith(tokenUrl + '/move'));
        await confirm.click();
        assert.equal((await accepted).status(), 200);
        await first.waitForTimeout(1000);
        const combatState = await snapshot(first),
            moved = combatState.tokens.find((t) => t.id === token.id);
        assert.ok(
            combatState.combat.combatants.find((c) => c.tokenId === token.id).budget.movementSpent >
                0,
        );
        await doubleClick(first, token.id, moved, right);
        await confirm.waitFor();
        assert.equal(await confirm.isEnabled(), false);
        await first.keyboard.press('Escape');
        const otherEntry = combat.combatants.find((c) => c.tokenId !== token.id);
        await doubleClick(first, token.id, moved, p(-50));
        await confirm.waitFor();
        assert.equal(await confirm.isEnabled(), true);
        await api(gm, scene + '/combat/current', 'POST', {
            combatId: combat.id,
            combatantId: otherEntry.id,
        });
        await confirm.waitFor({ state: 'detached' });
        await doubleClick(first, token.id, moved, p(-50));
        await confirm.waitFor();
        assert.equal(await confirm.isEnabled(), false);
        await api(first, tokenUrl + '/move', 'POST', p(-50), 422);
        await first.keyboard.press('Escape');
        record(
            'Combat: preview cost, explicit confirmation, Escape, remaining budget and wrong-turn rejection',
        );
        await second.reload();
        await subscribed(second);
        assert.equal((await snapshot(second)).tokens.find((t) => t.id === token.id).x, moved.x);
        await gm.screenshot({ path: path.join(out, 'gm.png') });
        record('Reload snapshot and existing realtime channels preserve the accepted position');
        assert.deepEqual(errors, []);
    } finally {
        try {
            if (gm && baseline) {
                if (props.length)
                    await api(gm, scene + '/selection', 'POST', {
                        action: 'delete',
                        tokenIds: [],
                        propIds: props,
                    });
                for (const id of presets)
                    await api(gm, '/library/object-presets/' + id, 'DELETE', undefined, 204);
                if (structureEdit)
                    await api(gm, scene + '/edit-history', 'POST', {
                        changes: [
                            {
                                kind: 'structure',
                                id: '5',
                                expected: structureEdit.after,
                                value: structureEdit.before,
                            },
                        ],
                    });
                if (token)
                    await api(gm, '/tokens/' + token.id, 'PATCH', {
                        x: token.x,
                        y: token.y,
                        size: token.size,
                        scale: token.scale,
                    });
                await api(gm, scene + '/grid', 'PUT', baseline.grid);
                if (mapChanged)
                    await api(gm, scene + '/edit-history', 'POST', {
                        changes: [
                            {
                                kind: 'mapWorld',
                                id: '5',
                                expected: mapState(await snapshot(gm)),
                                value: mapState(baseline),
                            },
                        ],
                    });
                if (combatChanged)
                    execFileSync('php', ['artisan', 'qa:townhouse'], { cwd: root, stdio: 'pipe' });
                // The recipe restores prepared combat, but users may have repositioned
                // fixture actors. Restore their actual pre-run layout after the recipe.
                if (combatChanged) for (const t of baseline.tokens)
                    await api(gm, '/tokens/' + t.id, 'PATCH', { x: t.x, y: t.y, size: t.size, scale: t.scale });
                const restored = await snapshot(gm);
                assert.deepEqual(restored.grid, baseline.grid);
                assert.deepEqual(restored.structure?.graph, baseline.structure?.graph);
                assert.equal(restored.props.length, baseline.props.length);
                assert.deepEqual(
                    restored.tokens.map(({ id, x, y }) => ({ id, x, y })),
                    baseline.tokens.map(({ id, x, y }) => ({ id, x, y })),
                );
                assert.notEqual(restored.combat?.status, 'active');
                record('Temporary props/preset/geometry removed; fixture restored');
            }
        } finally {
            fs.writeFileSync(
                path.join(out, 'browser-report.json'),
                JSON.stringify({ checks: report, errors }, null, 2),
            );
            await browser.close();
        }
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
