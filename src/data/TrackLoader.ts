import { TrackData } from '../rendering/TrackMesh';

const TRACK_IDS = ['city', 'coast', 'desert'];

export class TrackLoader {
  private cache: Map<string, TrackData> = new Map();

  async load(trackId: string): Promise<TrackData> {
    const cached = this.cache.get(trackId);
    if (cached) return cached;

    const data = await import(`./tracks/${trackId}.json`);
    const trackData = data.default as TrackData;
    this.cache.set(trackId, trackData);
    return trackData;
  }

  getAvailableTracks(): string[] {
    return TRACK_IDS;
  }
}
