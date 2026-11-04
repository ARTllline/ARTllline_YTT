import { findRoute, type NavigationRequest } from './pathfinding';

self.onmessage = ({ data }: MessageEvent<NavigationRequest>) => {
    self.postMessage(findRoute(data));
};
