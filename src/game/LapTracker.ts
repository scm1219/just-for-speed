import * as CANNON from 'cannon-es';
import { Vehicle } from '../physics/Vehicle';
import { TrackMesh } from '../rendering/TrackMesh';

export interface RacerState {
  vehicle: Vehicle;
  currentCheckpoint: number;
  currentLap: number;
  totalLaps: number;
  lapTimes: number[];
  lapStartTime: number;
  raceStartTime: number;
  finished: boolean;
  isPlayer: boolean;
}

export class LapTracker {
  private racers: RacerState[] = [];
  private checkpoints: { position: CANNON.Vec3; tValue: number }[] = [];
  private triggerDistance: number = 8;
  private trackMesh: TrackMesh;

  constructor(trackMesh: TrackMesh, checkpointTValues: number[], totalLaps: number) {
    this.trackMesh = trackMesh;
    for (const t of checkpointTValues) {
      const point = trackMesh.getPointAt(t);
      this.checkpoints.push({
        position: new CANNON.Vec3(point.x, point.y, point.z),
        tValue: t,
      });
    }
  }

  addRacer(vehicle: Vehicle, isPlayer: boolean): RacerState {
    const state: RacerState = {
      vehicle,
      currentCheckpoint: 0,
      currentLap: 0,
      totalLaps: 3,
      lapTimes: [],
      lapStartTime: 0,
      raceStartTime: 0,
      finished: false,
      isPlayer,
    };
    this.racers.push(state);
    return state;
  }

  startRace(currentTime: number): void {
    for (const racer of this.racers) {
      racer.raceStartTime = currentTime;
      racer.lapStartTime = currentTime;
      racer.currentLap = 1;
      racer.currentCheckpoint = 0;
      racer.lapTimes = [];
      racer.finished = false;
    }
  }

  update(currentTime: number): void {
    for (const racer of this.racers) {
      if (racer.finished) continue;
      const pos = racer.vehicle.getPosition();
      const checkpoint = this.checkpoints[racer.currentCheckpoint];
      const dx = pos.x - checkpoint.position.x;
      const dz = pos.z - checkpoint.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < this.triggerDistance) {
        racer.currentCheckpoint++;
        if (racer.currentCheckpoint >= this.checkpoints.length) {
          racer.currentCheckpoint = 0;
          const lapTime = currentTime - racer.lapStartTime;
          racer.lapTimes.push(lapTime);
          racer.lapStartTime = currentTime;
          if (racer.currentLap >= racer.totalLaps) {
            racer.finished = true;
          } else {
            racer.currentLap++;
          }
        }
      }
    }
  }

  getStandings(): RacerState[] {
    return [...this.racers].sort((a, b) => {
      if (a.finished && !b.finished) return -1;
      if (!a.finished && b.finished) return 1;
      if (a.finished && b.finished) return a.lapTimes[a.lapTimes.length - 1] - b.lapTimes[b.lapTimes.length - 1];
      if (a.currentLap !== b.currentLap) return b.currentLap - a.currentLap;
      if (a.currentCheckpoint !== b.currentCheckpoint) return b.currentCheckpoint - a.currentCheckpoint;
      return this.distToNextCheckpoint(a) - this.distToNextCheckpoint(b);
    });
  }

  getPlayerState(): RacerState | undefined {
    return this.racers.find(r => r.isPlayer);
  }

  isRaceComplete(): boolean {
    return this.racers.some(r => r.isPlayer && r.finished);
  }

  private distToNextCheckpoint(racer: RacerState): number {
    const pos = racer.vehicle.getPosition();
    const cp = this.checkpoints[racer.currentCheckpoint];
    const dx = pos.x - cp.position.x;
    const dz = pos.z - cp.position.z;
    return Math.sqrt(dx * dx + dz * dz);
  }
}
