export const VISION_FEATHER_CELLS = 0.65;

// Used for color only. Entity masking and reveal playback keep their authorized samples.
export const visualCoverage = `
    float featheredVision(sampler2D mask, vec2 uv, vec2 stepUV, float center) {
        if (center <= 0.0 || center >= 1.0 || stepUV.x == 0.0) return center;
        vec2 dx = vec2(stepUV.x, 0.0);
        vec2 dy = vec2(0.0, stepUV.y);
        float neighbors = texture(mask, uv - dx).a + texture(mask, uv + dx).a
            + texture(mask, uv - dy).a + texture(mask, uv + dy).a;
        return min(center, 0.5 * center + 0.125 * neighbors);
    }
    float visualCoverage(float coverage) {
        float edge = 1.0 - coverage;
        return coverage * (1.0 - 0.5 * edge * edge);
    }`;
