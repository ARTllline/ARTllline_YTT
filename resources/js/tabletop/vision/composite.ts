import { GlProgram, Mesh, MeshGeometry, Shader, Texture, UniformGroup } from 'pixi.js';

/** A fixed quad: animation changes uniforms, never polygons, Graphics or render targets. */
export function visionComposite() {
    const uniforms = new UniformGroup({
        uProgress: { value: 1, type: 'f32' },
        uBase: { value: 0.94, type: 'f32' },
        uMemoryScale: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
    });
    const shader = new Shader({
        glProgram: GlProgram.from({
            name: 'authorized-vision-composite',
            vertex: `
                in vec2 aPosition;
                in vec2 aUV;
                uniform mat3 uProjectionMatrix;
                uniform mat3 uWorldTransformMatrix;
                uniform mat3 uTransformMatrix;
                out vec2 vUV;
                void main() {
                    vUV = aUV;
                    gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
                }`,
            fragment: `
                in vec2 vUV;
                uniform sampler2D uCurrent;
                uniform sampler2D uPrevious;
                uniform sampler2D uMemory;
                uniform float uProgress;
                uniform float uBase;
                uniform vec2 uMemoryScale;
                uniform vec4 uColor;
                out vec4 finalColor;
                void main() {
                    float current = texture(uCurrent, vUV).a;
                    float previous = texture(uPrevious, vUV).a;
                    // New territory is bounded by current authority. Live objects use
                    // the exact currentMask, without retaining a revoked entity image.
                    float memory = texture(uMemory, vUV * uMemoryScale).a;
                    float reveal = current * mix(previous, 1.0, uProgress);
                    // Already authorized territory may dim with playback. Only the public
                    // background remains here: live objects use the exact NEW currentMask.
                    // Reset memory removes this permission immediately as well.
                    reveal += (1.0 - current) * previous * memory * (1.0 - uProgress);
                    float alpha = mix(uBase, 0.62, memory) * (1.0 - reveal);
                    finalColor = vec4(vec3(11.0, 17.0, 25.0) / 255.0 * alpha, alpha) * uColor;
                }`,
        }),
        resources: {
            visionUniforms: uniforms,
            uCurrent: Texture.EMPTY.source,
            uPrevious: Texture.EMPTY.source,
            uMemory: Texture.EMPTY.source,
        },
    });
    const geometry = new MeshGeometry({
        positions: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    const display = new Mesh({ geometry, shader });
    return { display, uniforms, shader, geometry };
}
