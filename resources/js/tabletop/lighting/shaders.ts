import {
    extensions,
    GlProgram,
    Mesh,
    MeshGeometry,
    SaturationBlend,
    Shader,
    Texture,
    UniformGroup,
} from 'pixi.js';
import { visualCoverage } from '../vision/coverage';

const vertex = `
    in vec2 aPosition;
    in vec2 aUV;
    uniform mat3 uProjectionMatrix;
    uniform mat3 uWorldTransformMatrix;
    uniform mat3 uTransformMatrix;
    out vec2 vUV;
    void main() {
        vUV = aUV;
        gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    }`;
function quad(shader: Shader) {
    const geometry = new MeshGeometry({
        positions: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    const mesh = new Mesh({ geometry, shader });
    return { mesh, shader, geometry };
}
export function lightShader() {
    const uniforms = new UniformGroup({
        uOrigin: { value: new Float32Array(2), type: 'vec2<f32>' },
        uWorld: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
        uMaskScale: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
        uMaskStep: { value: new Float32Array(2), type: 'vec2<f32>' },
        uTint: { value: new Float32Array([1, 1, 1]), type: 'vec3<f32>' },
        uRadius: { value: 1, type: 'f32' },
        uIntensity: { value: 1, type: 'f32' },
        uFalloff: { value: 1, type: 'f32' },
    });
    const shader = new Shader({
        glProgram: GlProgram.from({
            name: 'map-local-light',
            vertex,
            fragment: `
            in vec2 vUV;
            uniform sampler2D uMask;
            uniform vec2 uOrigin;
            uniform vec2 uWorld;
            uniform vec2 uMaskScale;
            uniform vec2 uMaskStep;
            uniform vec3 uTint;
            uniform float uRadius;
            uniform float uIntensity;
            uniform float uFalloff;
            out vec4 finalColor;
            float shadowCoverage(vec2 uv) {
                float center = texture(uMask, uv).a;
                if (center <= 0.0) return 0.0;
                vec2 dx = vec2(uMaskStep.x, 0.0);
                vec2 dy = vec2(0.0, uMaskStep.y);
                float neighbors = texture(uMask, uv - dx).a + texture(uMask, uv + dx).a
                    + texture(uMask, uv - dy).a + texture(uMask, uv + dy).a;
                // Round raster corners without lighting the blocked side of the mask.
                return min(2.0 * center, 0.5 * center + 0.125 * neighbors);
            }
            void main() {
                vec2 centered = vUV * 2.0 - 1.0;
                vec2 world = uOrigin + centered * uRadius;
                float d = length(centered);
                float radial = pow(1.0 - smoothstep(0.0, 1.0, d), uFalloff);
                float mask = shadowCoverage((world / uWorld) * uMaskScale);
                // Reserve headroom for two overlapping sources in the existing RGB8 target.
                finalColor = vec4(uTint * radial * uIntensity * mask * 0.5, 1.0);
            }`,
        }),
        resources: { lightUniforms: uniforms, uMask: Texture.EMPTY.source },
    });
    const result = quad(shader);
    result.mesh.blendMode = 'add';
    return { ...result, uniforms };
}
export function lightingComposite() {
    const uniforms = new UniformGroup({
        uClipped: { value: 0, type: 'f32' },
        uLightFloor: { value: 0, type: 'f32' },
        uAmbient: { value: new Float32Array(3), type: 'vec3<f32>' },
        uUnseen: { value: 1, type: 'f32' },
        uVisionScale: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
        uVisionFeather: { value: new Float32Array(2), type: 'vec2<f32>' },
    });
    const shader = new Shader({
        glProgram: GlProgram.from({
            name: 'map-lighting-composite',
            vertex,
            fragment: `
            in vec2 vUV;
            uniform sampler2D uLightmap;
            uniform sampler2D uCurrent;
            uniform float uClipped;
            uniform float uLightFloor;
            uniform vec3 uAmbient;
            uniform float uUnseen;
            uniform vec2 uVisionScale;
            uniform vec2 uVisionFeather;
            out vec4 finalColor;
            ${visualCoverage}
            void main() {
                float current = 1.0;
                float darkvision = 0.0;
                if (uClipped > 0.0) {
                    vec2 uv = vUV * uVisionScale;
                    vec4 vision = texture(uCurrent, uv);
                    if (vision.a <= 0.0) {
                        finalColor = vec4(vec3(uUnseen), 1.0);
                        return;
                    }
                    current = visualCoverage(featheredVision(uCurrent, uv, uVisionFeather, vision.a));
                    darkvision = clamp(vision.a - vision.g, 0.0, 1.0);
                }
                vec3 localLight = texture(uLightmap, vUV).rgb * 2.0;
                float peak = max(localLight.r, max(localLight.g, localLight.b));
                // Compress as a color, so overlap rolls off without clipping individual channels.
                localLight /= 1.0 + 0.5 * peak;
                float neutral = dot(localLight, vec3(0.30, 0.55, 0.15));
                localLight = mix(localLight, vec3(neutral), 0.22);
                vec3 light = uAmbient + (1.0 - uAmbient) * localLight;
                light = mix(vec3(0.89, 0.95, 1.0) * uLightFloor, vec3(1.0), light);
                light = mix(light, vec3(0.68), darkvision);
                finalColor = vec4(mix(vec3(uUnseen), light, current), 1.0);
            }`,
        }),
        resources: {
            compositeUniforms: uniforms,
            uLightmap: Texture.EMPTY.source,
            uCurrent: Texture.EMPTY.source,
        },
    });
    const result = quad(shader);
    result.mesh.blendMode = 'multiply';
    return { ...result, uniforms };
}

export function darkvisionComposite() {
    extensions.add(SaturationBlend);
    const uniforms = new UniformGroup({
        uVisionScale: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
    });
    const shader = new Shader({
        glProgram: GlProgram.from({
            name: 'map-darkvision-color',
            vertex,
            fragment: `
            in vec2 vUV;
            uniform sampler2D uCurrent;
            uniform vec2 uVisionScale;
            out vec4 finalColor;
            void main() {
                vec4 vision = texture(uCurrent, vUV * uVisionScale);
                float darkvision = clamp(vision.a - vision.g, 0.0, 1.0);
                finalColor = vec4(0.0, 0.0, 0.0, darkvision);
            }`,
        }),
        resources: { darkvisionUniforms: uniforms, uCurrent: Texture.EMPTY.source },
    });
    const result = quad(shader);
    result.mesh.blendMode = 'saturation';
    return { ...result, uniforms };
}
