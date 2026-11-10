/* eslint-disable @typescript-eslint/no-require-imports -- Chromium QA of the dedicated acceptance scene. */
/* global require, process, console, window, HTMLInputElement, Event, requestAnimationFrame, performance */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(
    process.env.USERPROFILE +
        '/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
);
const { api, base, login, subscribed, tabletop } = require('./map07a.cjs');
const { align, position } = require('./builder06.cjs');

const out = 'artifacts/map-p2c';
const campaign = '/campaigns/5';
const name = 'Лесная таверна · Fantasy Classic';
const width = 1440;
const height = 1020;
const center = [width / 2, height / 2];
const options = { viewport: { width: 1680, height: 1060 }, reducedMotion: 'reduce' };
const button = (page, name) => page.getByRole('button', { name, exact: true });
const report = { mutations: [], frames: {}, terrainReadConflicts: 0, errors: [], checks: [] };
const save = () => fs.writeFileSync(out + '/report.json', JSON.stringify(report, null, 2));

async function ready(page) {
    await tabletop(page).waitFor();
    await subscribed(page);
    await page.locator('.scene-loading-indicator').waitFor({ state: 'hidden' });
    await page.locator('.scene-title-arrival').waitFor({ state: 'hidden' });
}

async function capture(page, name, canvas = false) {
    await page.waitForTimeout(350);
    await (canvas ? tabletop(page) : page).screenshot({ path: out + '/' + name + '.png' });
}

async function commit(page, scene, kind, action, label) {
    const pending = page.waitForResponse(
        (res) =>
            res.url().endsWith('/api' + scene + '/' + kind) &&
            ['POST', 'PUT'].includes(res.request().method()),
        { timeout: 12000 },
    );
    pending.catch(() => {});
    await action();
    const started = performance.now();
    const response = await pending;
    const data = await response.json();
    assert.ok(response.ok(), label + ': ' + response.status() + ' ' + data.message);
    report.mutations.push({ kind, label, afterInputMs: Math.round(performance.now() - started) });
    await page.locator('.map-editor-status .save-saved').waitFor();
    return data;
}

async function slider(page, label, value) {
    await page.getByLabel(label, { exact: true }).evaluate((el, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }, String(value));
}

async function draw(page, points) {
    const coords = await Promise.all(points.map((point) => position(page, point)));
    await page.mouse.move(...coords[0]);
    await page.mouse.down();
    for (const point of coords.slice(1)) await page.mouse.move(...point, { steps: 7 });
    await page.mouse.up();
}

async function frameIntervals(page) {
    return page.evaluate(async () => {
        const samples = [];
        await new Promise((done) => {
            let previous;
            const frame = (now) => {
                if (previous !== undefined) samples.push(now - previous);
                previous = now;
                if (samples.length < 120) requestAnimationFrame(frame);
                else done();
            };
            requestAnimationFrame(frame);
        });
        samples.sort((a, b) => a - b);
        return { median: samples[60], p95: samples[113], p99: samples[118] };
    });
}

async function terrain(gm, scene) {
    await button(gm, 'Terrain').click();
    async function brush(name, size, softness, strength = 255) {
        await gm
            .getByRole('button', { name: new RegExp('^Рисовать: Fantasy Classic.*' + name + '$') })
            .click();
        await slider(gm, 'Размер кисти', size);
        await slider(gm, 'Мягкость', softness);
        await slider(gm, 'Непрозрачность', strength);
    }
    const stroke = (label, points) => commit(gm, scene, 'terrain', () => draw(gm, points), label);
    await brush('Луговая трава', 680, 18);
    for (const y of [50, 360, 680, 975]) {
        await stroke('grass ' + y, [
            [20, y],
            [465, y],
            [950, y],
            [1420, y],
        ]);
    }
    await brush('Лесная подстилка', 255, 205, 240);
    await stroke('woodland edge', [
        [52, 140],
        [238, 91],
        [520, 78],
        [776, 85],
        [1110, 96],
        [1350, 220],
    ]);
    await stroke('woodland pocket', [
        [54, 282],
        [163, 402],
        [127, 580],
        [222, 708],
    ]);
    await stroke('woodland south', [
        [876, 989],
        [1070, 965],
        [1300, 912],
        [1400, 797],
    ]);
    const road = [
        [20, 932],
        [260, 878],
        [540, 862],
        [830, 899],
        [1085, 816],
        [1420, 750],
    ];
    const entrance = [
        [610, 869],
        [650, 786],
        [650, 647],
    ];
    await brush('Утоптанный грунт', 244, 171);
    await stroke('road shoulders', road);
    await stroke('entrance apron', entrance);
    await brush('Мелкий гравий', 105, 177, 206);
    await stroke('road', road);
    await stroke('entrance', entrance);
    await capture(gm, '02-terrain');
}

async function build(gm, scene, snap) {
    await button(gm, 'Build').click();
    const material = async (label, name) => {
        await gm.getByRole('button', { name: label, exact: true }).click();
        await gm
            .locator('.build-material-popover')
            .getByRole('button', { name: new RegExp('Fantasy Classic.*' + name + '$') })
            .click();
    };
    await button(gm, 'Комната').click();
    let graph = (await snap()).structure?.graph;
    for (const [i, from, to, wall, floor] of [
        [0, [360, 240], [900, 660], 'Грубая кладка', 'Медовые доски'],
        [1, [900, 240], [1140, 480], 'Известка и балки', 'Сланцевые плиты'],
    ]) {
        if ((graph?.rooms.length ?? 0) > i) continue;
        await material('Материал стены', wall);
        await material('Материал пола', floor);
        graph = (await commit(gm, scene, 'structure', () => draw(gm, [from, to]), floor)).structure
            .graph;
    }
    assert.equal(graph.rooms.length, 2);
    for (const [tool, style, positions] of [
        [
            'Дверь',
            'Дубовая дверь с ковкой',
            [
                [660, 660],
                [900, 360],
                [1020, 240],
            ],
        ],
        [
            'Окно',
            'Свинцовый витраж в дубе',
            [
                [480, 240],
                [780, 240],
                [360, 440],
                [1140, 360],
                [810, 660],
            ],
        ],
    ]) {
        await button(gm, tool).click();
        await material('Стиль ' + (tool === 'Дверь' ? 'двери' : 'окна'), style);
        for (const point of positions) {
            if (
                graph.openings.some((opening) => {
                    const edge = graph.edges.find((edge) => edge.id === opening.edgeId);
                    const a = graph.vertices.find((vertex) => vertex.id === edge.a);
                    const b = graph.vertices.find((vertex) => vertex.id === edge.b);
                    return (
                        Math.hypot(
                            point[0] - a.x - (b.x - a.x) * opening.center,
                            point[1] - a.y - (b.y - a.y) * opening.center,
                        ) < 10
                    );
                })
            )
                continue;
            const coords = await position(gm, point);
            graph = (
                await commit(
                    gm,
                    scene,
                    'structure',
                    () => gm.mouse.click(...coords),
                    tool + ' ' + point,
                )
            ).structure.graph;
        }
    }
    assert.equal(graph.openings.length, 8);
    await capture(gm, '03-build');
}

const layout = [
    [
        'woodland-oak',
        [
            [85, 205, 15, 1.1],
            [335, 104],
            [755, 101, 75],
            [1139, 107],
            [1340, 251, 45],
            [1330, 936],
        ],
    ],
    [
        'woodland-fir',
        [
            [207, 115],
            [517, 85, 60],
            [959, 88],
            [1320, 117],
            [109, 570, 30],
            [139, 772],
            [1220, 947],
        ],
    ],
    [
        'fallen-log',
        [
            [233, 293, 30],
            [1250, 624, 120],
        ],
    ],
    [
        'mossy-rocks',
        [
            [244, 445],
            [262, 675, 45],
            [1260, 283],
            [1334, 552],
            [1052, 946],
        ],
    ],
    [
        'oak-stump',
        [
            [315, 571],
            [1256, 477],
        ],
    ],
    [
        'woodland-fern',
        [
            [137, 336],
            [258, 377],
            [340, 756],
            [1169, 605],
            [1360, 674],
            [1171, 884],
        ],
    ],
    [
        'flowering-shrub',
        [
            [300, 220],
            [1188, 197],
            [375, 719],
            [851, 721],
            [180, 649],
        ],
    ],
    [
        'woven-rug',
        [
            [659, 589, 90],
            [650, 387, 90],
        ],
    ],
    ['tavern-counter', [[652, 284]]],
    [
        'trestle-table',
        [
            [491, 389],
            [796, 474],
            [488, 553],
        ],
    ],
    [
        'round-table',
        [
            [786, 339],
            [241, 546],
        ],
    ],
    [
        'oak-bench',
        [
            [491, 335],
            [491, 445],
            [796, 530],
            [489, 606],
        ],
    ],
    [
        'oak-chair',
        [
            [786, 289, 180],
            [785, 389],
            [241, 490, 180],
            [241, 594],
        ],
    ],
    [
        'wooden-crate',
        [
            [919, 520, 15],
            [986, 503, 30],
            [1074, 442],
        ],
    ],
    [
        'ironbound-barrel',
        [
            [835, 288],
            [1088, 395],
            [1070, 520],
            [1132, 523],
        ],
    ],
    [
        'firewood-stack',
        [
            [1090, 281],
            [309, 772, 30],
        ],
    ],
    ['stone-hearth', [[978, 285]]],
    ['campfire', [[239, 758]]],
    [
        'iron-lantern',
        [
            [665, 691],
            [663, 275],
            [870, 402],
            [1118, 410],
        ],
    ],
    [
        'candle-tray',
        [
            [491, 389],
            [796, 474],
            [488, 553],
            [786, 339],
        ],
    ],
];

async function objects(gm, scene, snap) {
    await button(gm, 'Objects').click();
    const catalog = await api(gm, '/library/object-presets?source=builtin');
    assert.equal(catalog.presets.length, 20);
    const initial = (await snap()).props;
    for (const [key, stamps] of layout) {
        const preset = catalog.presets.find(
            (p) => p.asset.url && p.name === pack.objects.find((p) => p.key === key).name,
        );
        assert.ok(preset, key);
        const remaining = stamps.filter(
            ([x, y]) =>
                !initial.some((p) => p.name === preset.name && Math.hypot(p.x - x, p.y - y) < 5),
        );
        if (!remaining.length) continue;
        await button(gm, 'Object Presets').click();
        if (key === 'woodland-oak') {
            await gm.getByLabel('Источник пресетов').selectOption('builtin');
            await button(gm, 'Природа').click();
            await gm.waitForFunction(() => {
                const images = [...window.document.querySelectorAll('.object-preset-grid img')];
                return images.length === 7 && images.every((image) => image.naturalWidth > 0);
            });
            await capture(gm, '04-object-catalog');
        }
        await gm.getByLabel('Поиск пресетов').fill(key);
        const card = gm.locator('.object-preset-grid article').filter({ hasText: preset.name });
        await button(card, 'Разместить').click();
        let angle = 0;
        let scale = 1;
        for (const [x, y, rotation = 0, factor = 1] of remaining) {
            while (angle !== rotation) {
                await gm.keyboard.press(angle < rotation ? 'KeyR' : 'Shift+KeyR');
                angle += angle < rotation ? 15 : -15;
            }
            if (scale !== factor) {
                await gm.keyboard.press(scale < factor ? 'BracketRight' : 'BracketLeft');
                scale = factor;
            }
            const point = await position(gm, [x, y]);
            await gm.mouse.move(...point);
            if (key === 'woodland-oak' && x === 85) await capture(gm, '05-stamp-preview');
            const result = await commit(gm, scene, 'props', () => gm.mouse.click(...point), key);
            const prop = result.props[0];
            assert.equal(prop.name, preset.name);
            assert.equal(prop.rotation, rotation);
            assert.equal(prop.scaleX, factor);
            assert.ok(Math.hypot(prop.x - x, prop.y - y) < 5, 'Unexpected stamp offset for ' + key);
        }
        await gm.keyboard.press('Escape');
    }
    assert.equal(
        (await snap()).props.length,
        layout.reduce((count, [, stamps]) => count + stamps.length, 0),
    );
}

const pack = require('../../resources/environment/fantasy-classic/manifest.json');

(async () => {
    fs.mkdirSync(out, { recursive: true });
    const accounts = JSON.parse(
        fs.readFileSync('artifacts/permanent-playground-20261030/accounts.private.json'),
    );
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    let gm, oldActive;
    const observe = (page, role) => {
        page.on('pageerror', (error) => report.errors.push(role + ': ' + error.message));
        page.on('console', (message) => {
            if (message.type() !== 'error') return;
            if (
                message.text().includes('409') &&
                /\/terrain\/\d+\/\d+\?hash=/.test(message.location().url)
            ) {
                report.terrainReadConflicts++;
                return;
            }
            report.errors.push(role + ': ' + message.text());
        });
    };
    try {
        gm = await login(
            browser,
            accounts.find((account) => account.id === 1),
            options,
        );
        observe(gm, 'GM');
        const previous = (await api(gm, campaign)).activeSceneId;
        let data = (await api(gm, campaign + '/scenes')).scenes.find(
            (scene) => scene.name === name,
        );
        if (!data) {
            const grid = {
                size: 60,
                offset: { x: 0, y: 0 },
                visible: false,
                snap: false,
                distanceUnit: 'ft',
                distancePerCell: 5,
            };
            data = await api(gm, campaign + '/scene-preparation', 'POST', {
                name,
                width,
                height,
                grid,
                map: null,
            });
        }
        const scene = '/scenes/' + data.id;
        const snap = () => api(gm, scene + '/snapshot');
        report.scene = data.id;
        assert.notEqual(String(data.id), '5');
        assert.notEqual(String(data.id), '7');
        oldActive = previous;
        const start = await snap();
        assert.equal(start.map, null);
        if (!start.mapWorld) {
            await api(gm, scene + '/map-world', 'POST', {
                expected: { enabled: false, width, height, grid: start.grid, map: null },
                value: { enabled: true, width, height, grid: start.grid, map: null },
            });
        }
        await gm.goto(base + campaign + scene + '?mode=prepare');
        await ready(gm);
        const close = button(gm, 'Закрыть библиотеку');
        if (await close.isVisible()) await close.click();
        await button(gm, 'Редактировать карту').click();
        await align(gm, 0.59, center);
        if (!start.terrain?.chunks.length) {
            await capture(gm, '01-empty-mapworld');
            await terrain(gm, scene);
        }
        await build(gm, scene, snap);
        await objects(gm, scene, snap);
        const light = scene + '/lighting';
        const beforeLight = (await snap()).lighting;
        const day = { ...beforeLight, enabled: true, mode: 'day', brightness: 1, color: '#fff4df' };
        await api(gm, light, 'PUT', { expected: beforeLight, value: day });
        try {
            await button(gm, 'Закрыть редактор карты').click();
            await align(gm, 0.63, center);
            await capture(gm, '06-gm-day', true);
        } finally {
            await api(gm, light, 'PUT', { expected: day, value: beforeLight });
        }
        await gm.reload();
        await ready(gm);
        if (await close.isVisible()) await close.click();
        await button(gm, 'Редактировать карту').click();
        await align(gm, 0.59, center);
        await button(gm, 'Свет').click();
        await button(gm, 'Ночь').click();
        await slider(gm, 'Фоновая яркость', 0.35);
        if (await button(gm, 'Сохранить свет').isEnabled()) {
            await commit(
                gm,
                scene,
                'lighting',
                () => button(gm, 'Сохранить свет').click(),
                'evening ambient',
            );
        }
        const lit = await api(gm, light);
        assert.equal(lit.sources.length, 10);
        report.checks.push('Terrain, rooms, openings and repeated object placement via Map Editor');
        await api(gm, campaign + '/activate', 'POST', { sceneId: data.id });
        const player = await login(
            browser,
            accounts.find((account) => account.id === 2),
            options,
        );
        observe(player, 'Player');
        await player.goto(base + campaign + '/play');
        await ready(player);
        await button(gm, 'Objects').click();
        const lightPreset = (
            await api(gm, '/library/object-presets?source=builtin&search=iron-lantern')
        ).presets[0];
        await button(gm, 'Object Presets').click();
        await gm.getByLabel('Поиск пресетов').fill('iron-lantern');
        await button(
            gm.locator('.object-preset-grid article').filter({ hasText: lightPreset.name }),
            'Разместить',
        ).click();
        const trial = await position(gm, [420, 706]);
        const added = await commit(
            gm,
            scene,
            'props',
            () => gm.mouse.click(...trial),
            'history lamp',
        );
        await gm.keyboard.press('Escape');
        const realtime = await player
            .waitForFunction(
                ({ id, revision }) =>
                    window.movementFrames.some((frame) => {
                        const packet = JSON.parse(frame);
                        if (packet.event !== 'tabletop') return false;
                        const data =
                            typeof packet.data === 'string' ? JSON.parse(packet.data) : packet.data;
                        return (
                            data.type === 'lighting.frame' &&
                            data.revision >= revision &&
                            data.render?.sources.some((source) => source.id === 'prop:' + id)
                        );
                    }),
                { id: added.props[0].id, revision: added.revision },
                { timeout: 8000 },
            )
            .catch(() => null);
        await commit(gm, scene, 'edit-history', () => gm.keyboard.press('Control+z'), 'undo lamp');
        assert.equal((await api(gm, light)).sources.length, 10);
        await commit(
            gm,
            scene,
            'edit-history',
            () => gm.keyboard.press('Control+Shift+z'),
            'redo lamp',
        );
        assert.equal((await api(gm, light)).sources.length, 11);
        await commit(
            gm,
            scene,
            'edit-history',
            () => gm.keyboard.press('Control+z'),
            'restore trial',
        );
        assert.ok(realtime, 'Player did not receive the stamped light over Reverb');
        const final = await snap();
        report.counts = {
            props: final.props.length,
            terrainChunks: final.terrain.chunks.length,
            rooms: final.structure.graph.rooms.length,
            openings: final.structure.graph.openings.length,
            lights: (await api(gm, light)).sources.length,
        };
        await gm.reload();
        await ready(gm);
        const reloaded = await snap();
        for (const key of ['props', 'terrain', 'structure', 'lighting'])
            assert.deepEqual(reloaded[key], final[key], key);
        report.checks.push('Prop and light Undo/Redo, repeat reload');
        await align(gm, 0.63, center);
        report.frames.gmEvening = await frameIntervals(gm);
        await capture(gm, '06-gm-evening', true);
        await align(gm, 1, [701, 430]);
        report.frames.gm100 = await frameIntervals(gm);
        await capture(gm, '07-gm-detail', true);
        const visible = await api(player, scene + '/snapshot');
        assert.equal(visible.props.length, final.props.length);
        assert.ok(visible.props.every((prop) => !prop.collider && !prop.preset));
        assert.equal((await api(player, light)).sources.length, 10);
        assert.equal(await button(player, 'Редактировать карту').count(), 0);
        await align(player, 0.63, center);
        report.frames.playerEvening = await frameIntervals(player);
        await capture(player, '08-player-evening', true);
        report.checks.push(
            'Separate Player context, Reverb light frame, rendered props and editor permissions',
        );
        assert.deepEqual(report.errors, []);
        report.passed = true;
    } catch (error) {
        report.failure = error.message;
        console.error(error);
        if (gm) await capture(gm, 'last-diagnostic').catch(() => {});
        process.exitCode = 1;
    } finally {
        if (gm && oldActive != null) {
            if (String((await api(gm, campaign)).activeSceneId) !== String(oldActive)) {
                await api(gm, campaign + '/activate', 'POST', { sceneId: oldActive });
            }
            report.restoredActive = oldActive;
        }
        await browser.close();
        save();
    }
})();
