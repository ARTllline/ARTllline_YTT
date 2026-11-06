import { extensions, GlProgram, Mesh, MeshGeometry, SaturationBlend, Shader, Texture, UniformGroup } from 'pixi.js';

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
            uniform vec3 uTint;
            uniform float uRadius;
            uniform float uIntensity;
            uniform float uFalloff;
            out vec4 finalColor;
            void main() {
                vec2 centered = vUV * 2.0 - 1.0;
                vec2 world = uOrigin + centered * uRadius;
                float d = length(centered);
                float radial = pow(1.0 - smoothstep(0.0, 1.0, d), uFalloff);
                float mask = texture(uMask, (world / uWorld) * uMaskScale).a;
                finalColor = vec4(uTint * radial * uIntensity * mask, 1.0);
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
            out vec4 finalColor;
            void main() {
                vec3 light = texture(uLightmap, vUV).rgb;
                light = mix(vec3(uLightFloor), vec3(1.0), light);
                vec4 vision = texture(uCurrent, vUV);
                float current = mix(1.0, vision.a, uClipped);
                float darkvision = clamp(vision.a - vision.g, 0.0, 1.0) * uClipped;
                light = mix(light, vec3(0.68), darkvision);
                finalColor = vec4(mix(vec3(1.0), light, current), 1.0);
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
    const shader = new Shader({
        glProgram: GlProgram.from({
            name: 'map-darkvision-color',
            vertex,
            fragment: `
            in vec2 vUV;
            uniform sampler2D uCurrent;
            out vec4 finalColor;
            void main() {
                vec4 vision = texture(uCurrent, vUV);
                float darkvision = clamp(vision.a - vision.g, 0.0, 1.0);
                finalColor = vec4(0.0, 0.0, 0.0, darkvision);
            }`,
        }),
        resources: { uCurrent: Texture.EMPTY.source },
    });
    const result = quad(shader);
    result.mesh.blendMode = 'saturation';
    return result;
}
