/** Native asynchronous inflate keeps anonymous RGB fields off the movement/render hot path. */
export async function spillPixels(encoded: string, expectedBytes: number): Promise<Uint8Array> {
    const compressed = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate'));
    const pixels = new Uint8Array(await new Response(stream).arrayBuffer());
    if (pixels.length !== expectedBytes) throw new Error('Invalid lighting field size');
    return pixels;
}
