import { GamePhase, GameState } from './GameState';
import { GameLoop } from './GameLoop';

export class GameManager {
  readonly loop: GameLoop;
  state: GameState;

  constructor() {
    this.loop = new GameLoop();
    this.state = {
      phase: GamePhase.MENU,
      selectedTrack: null,
      selectedDifficulty: null,
      lapCount: 0,
      totalLaps: 3,
      raceTime: 0,
      lapTimes: [],
    };
  }

  setPhase(phase: GamePhase): void {
    this.state.phase = phase;
  }
}
