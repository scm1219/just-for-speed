export interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  handbrake: boolean;
  useItem: boolean;
  pause: boolean;
  resetVehicle: boolean;
  steerX: number;
  accel: number;
  brake: number;
}

export class Keyboard {
  private keys: Set<string> = new Set();
  private justPressed: Set<string> = new Set();

  private static readonly GAME_KEYS = new Set([
    'KeyW', 'KeyA', 'KeyS', 'KeyD',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Space', 'ShiftLeft', 'ShiftRight', 'Escape', 'KeyR',
  ]);

  init(): void {
    window.addEventListener('keydown', (e) => {
      if (Keyboard.GAME_KEYS.has(e.code)) {
        e.preventDefault();
      }
      if (!this.keys.has(e.code)) {
        this.justPressed.add(e.code);
      }
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
  }

  getState(): InputState {
    const forward = this.keys.has('KeyW') || this.keys.has('ArrowUp');
    const backward = this.keys.has('KeyS') || this.keys.has('ArrowDown');
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight');

    return {
      forward,
      backward,
      left,
      right,
      handbrake: this.keys.has('Space'),
      useItem: this.justPressed.has('ShiftLeft') || this.justPressed.has('ShiftRight'),
      pause: this.justPressed.has('Escape'),
      resetVehicle: this.justPressed.has('KeyR'),
      steerX: (left ? -1 : 0) + (right ? 1 : 0),
      accel: forward ? 1 : 0,
      brake: backward ? 1 : 0,
    };
  }

  consumeJustPressed(): void {
    this.justPressed.clear();
  }
}
