import { StrokeRaster, type RasterRequest } from './StrokeRaster';

let raster: StrokeRaster;
self.onmessage = ({ data }: MessageEvent<RasterRequest>) => {
    if (data.settings) raster = new StrokeRaster(data.settings);
    const result = raster.batch(data.points);
    self.postMessage(result, { transfer: result.dirty.map(([, mask]) => mask.buffer) });
};
