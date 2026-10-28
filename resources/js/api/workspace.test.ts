import { afterEach, expect, it, vi } from 'vitest';
import { api } from './workspace';
import { setCsrf } from './client';

afterEach(() => vi.unstubAllGlobals());

it('maps Inspector fields to the explicit administrative contract and sends session CSRF', async () => {
    const fetch = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ revision: 9 }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    setCsrf('test-session-csrf');
    await api.token('42', {
        maxHp: 40,
        isHidden: true,
        isLocked: false,
        ownerUserId: '7',
        image: null,
    });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('/api/tokens/42');
    expect(options.method).toBe('PATCH');
    expect(options.credentials).toBe('same-origin');
    expect(options.headers['X-CSRF-TOKEN']).toBe('test-session-csrf');
    expect(JSON.parse(options.body)).toEqual({
        max_hp: 40,
        is_hidden: true,
        is_locked: false,
        owner_user_id: '7',
        token_image_asset_id: null,
    });
});

it('keeps validation and permission failures actionable at the API boundary', async () => {
    vi.stubGlobal(
        'fetch',
        vi
            .fn()
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({ errors: { owner_user_id: ['Choose a campaign member.'] } }),
                    { status: 422 },
                ),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 403 }),
            ),
    );
    await expect(api.token('42', { ownerUserId: '99' })).rejects.toMatchObject({
        status: 422,
        message: 'Choose a campaign member.',
    });
    await expect(api.snapshot('9')).rejects.toMatchObject({
        status: 403,
        message: 'You do not have permission to do that.',
    });
});
