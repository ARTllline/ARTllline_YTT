import { deflateSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { spillPixels } from './spill';

it('hydrates anonymous irradiance using native async inflate and validates its dimensions', async () => {
    const rgba = new Uint8Array([255, 150, 30, 255, 0, 0, 0, 0]);
    const encoded = deflateSync(rgba).toString('base64');
    expect(await spillPixels(encoded, 8)).toEqual(rgba);
    await expect(spillPixels(encoded, 4)).rejects.toThrow('Invalid lighting field size');
});
