export interface TrackScore {
  bestTotalTime: number | null;
  bestLapTime: number | null;
}

export class ScoreManager {
  private storageKey = 'just-for-speed-scores';
  private scores: Record<string, Record<string, TrackScore>> = {};

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const data = localStorage.getItem(this.storageKey);
      if (data) this.scores = JSON.parse(data);
    } catch {
      this.scores = {};
    }
  }

  private save(): void {
    localStorage.setItem(this.storageKey, JSON.stringify(this.scores));
  }

  getScore(trackId: string, difficulty: string): TrackScore {
    if (!this.scores[trackId]) this.scores[trackId] = {};
    if (!this.scores[trackId][difficulty]) {
      this.scores[trackId][difficulty] = { bestTotalTime: null, bestLapTime: null };
    }
    return this.scores[trackId][difficulty];
  }

  updateScore(trackId: string, difficulty: string, totalTime: number, bestLap: number): TrackScore {
    const score = this.getScore(trackId, difficulty);
    let updated = false;
    if (score.bestTotalTime === null || totalTime < score.bestTotalTime) {
      score.bestTotalTime = totalTime;
      updated = true;
    }
    if (score.bestLapTime === null || bestLap < score.bestLapTime) {
      score.bestLapTime = bestLap;
      updated = true;
    }
    if (updated) this.save();
    return score;
  }
}
