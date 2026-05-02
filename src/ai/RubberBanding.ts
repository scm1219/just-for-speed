export type Difficulty = 'easy' | 'normal' | 'hard';

export interface RubberBandConfig {
  behindBoostMin: number;
  behindBoostMax: number;
  aheadReductionMin: number;
  aheadReductionMax: number;
  enabled: boolean;
}

const DIFFICULTY_CONFIGS: Record<Difficulty, RubberBandConfig> = {
  easy: { behindBoostMin: 0, behindBoostMax: 0, aheadReductionMin: 0, aheadReductionMax: 0, enabled: false },
  normal: { behindBoostMin: 0.10, behindBoostMax: 0.15, aheadReductionMin: 0.05, aheadReductionMax: 0.10, enabled: true },
  hard: { behindBoostMin: 0.15, behindBoostMax: 0.20, aheadReductionMin: 0.08, aheadReductionMax: 0.15, enabled: true },
};

export class RubberBanding {
  private config: RubberBandConfig;
  private currentMultiplier: number = 1.0;

  constructor(difficulty: Difficulty) {
    this.config = DIFFICULTY_CONFIGS[difficulty];
  }

  update(playerProgress: number, aiProgress: number): void {
    if (!this.config.enabled) {
      this.currentMultiplier = 1.0;
      return;
    }
    const diff = playerProgress - aiProgress;
    if (diff > 0.3) {
      const t = Math.min((diff - 0.3) / 0.4, 1);
      this.currentMultiplier = 1 + this.config.behindBoostMin + t * (this.config.behindBoostMax - this.config.behindBoostMin);
    } else if (diff < -0.2) {
      const t = Math.min((-diff - 0.2) / 0.4, 1);
      this.currentMultiplier = 1 - this.config.aheadReductionMin - t * (this.config.aheadReductionMax - this.config.aheadReductionMin);
    } else {
      this.currentMultiplier = 1.0;
    }
  }

  getSpeedMultiplier(): number {
    return this.currentMultiplier;
  }
}
