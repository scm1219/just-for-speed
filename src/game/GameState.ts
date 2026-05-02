export enum GamePhase {
  MENU = 'MENU',
  TRACK_SELECT = 'TRACK_SELECT',
  COUNTDOWN = 'COUNTDOWN',
  RACING = 'RACING',
  PAUSED = 'PAUSED',
  RESULTS = 'RESULTS',
}

export type GameState = {
  phase: GamePhase;
  selectedTrack: string | null;
  selectedDifficulty: string | null;
  lapCount: number;
  totalLaps: number;
  raceTime: number;
  lapTimes: number[];
};
