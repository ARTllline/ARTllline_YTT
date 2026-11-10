import { GlProgram, Mesh, MeshGeometry, Shader, Texture, UniformGroup } from 'pixi.js';
import { visualCoverage } from './coverage';

/** A fixed quad: animation changes uniforms, never polygons, Graphics or render targets. */
export function visionComposite() {
    const uniforms = new UniformGroup({
        uProgress: { value: 1, type: 'f32' },
        uBase: { value: 0.94, type: 'f32' },
        uExplored: { value: 0.63, type: 'f32' },
        uManualEnabled: { value: 0, type: 'f32' },
        uMemoryScale: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
        uCurrentScale: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
        uPreviousScale: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
        uVisionFeather: { value: new Float32Array(2), type: 'vec2<f32>' },
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
                uniform sampler2D uManual;
                uniform float uProgress;
                uniform float uBase;
                uniform float uExplored;
                uniform float uManualEnabled;
                uniform vec2 uMemoryScale;
                uniform vec2 uCurrentScale;
                uniform vec2 uPreviousScale;
                uniform vec2 uVisionFeather;
                uniform vec4 uColor;
                out vec4 finalColor;
                ${visualCoverage}
                void main() {
                    vec2 currentUV = vUV * uCurrentScale;
                    float current = texture(uCurrent, currentUV).a;
                    // New territory is bounded by current authority. Live objects use
                    // the exact currentMask, without retaining a revoked entity image.
                    float memory = texture(uMemory, vUV * uMemoryScale).a;
                    // One manual texture carries both operations. Red encodes authorized
                    // public background reveal, the remaining alpha encodes cover.
                    vec4 manual = uManualEnabled > 0.0 ? texture(uManual, vUV) : vec4(0.0);
                    float reveal = featheredVision(uCurrent, currentUV, uVisionFeather, current);
                    // Already authorized territory may dim with playback. Only the public
                    // background remains here: live objects use the exact NEW currentMask.
                    // Reset memory removes this permission immediately as well.
                    if (uProgress < 1.0) {
                        float previous = texture(uPrevious, vUV * uPreviousScale).a;
                        reveal = reveal * mix(previous, 1.0, uProgress)
                            + (1.0 - current) * previous * memory * (1.0 - uProgress);
                    }
                    float remembered = max(manual.r, smoothstep(0.04, 0.96, memory));
                    float alpha = mix(uBase, uExplored, remembered) * (1.0 - visualCoverage(reveal));
                    vec4 automatic = vec4(vec3(12.0, 17.0, 26.0) / 255.0 * alpha, alpha);
                    float cover = clamp(manual.a - manual.r, 0.0, 1.0);
                    finalColor = mix(automatic, vec4(vec3(16.0, 24.0, 32.0) / 255.0, 1.0), cover) * uColor;
                }`,
        }),
        resources: {
            visionUniforms: uniforms,
            uCurrent: Texture.EMPTY.source,
            uPrevious: Texture.EMPTY.source,
            uMemory: Texture.EMPTY.source,
            uManual: Texture.EMPTY.source,
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
