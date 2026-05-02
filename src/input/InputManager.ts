import { Keyboard, type InputState } from './Keyboard';
export type { InputState } from './Keyboard';

export class InputManager {
  readonly keyboard = new Keyboard();

  private gamepadIndex: number | null = null;
  private currentInput: InputState = this.emptyState();

  init(): void {
    this.keyboard.init();
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadIndex = e.gamepad.index;
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.gamepadIndex = null;
    });
  }

  update(): void {
    const kb = this.keyboard.getState();
    this.currentInput = this.gamepadIndex !== null
      ? this.mergeWithGamepad(kb)
      : kb;
    this.keyboard.consumeJustPressed();
  }

  getInput(): InputState {
    return this.currentInput;
  }

  private mergeWithGamepad(kb: InputState): InputState {
    const gp = navigator.getGamepads()[this.gamepadIndex!];
    if (!gp) return kb;

    const deadzone = 0.15;
    const steerX = Math.abs(gp.axes[0]) > deadzone ? gp.axes[0] : 0;
    const accel = gp.buttons[7]?.value ?? 0;
    const brake = gp.buttons[6]?.value ?? 0;
    const handbrake = gp.buttons[1]?.pressed ?? false;
    const useItem = gp.buttons[0]?.pressed ?? false;
    const pause = gp.buttons[9]?.pressed ?? false;

    return {
      forward: kb.forward || accel > 0.1,
      backward: kb.backward || brake > 0.1,
      left: kb.left || steerX < -deadzone,
      right: kb.right || steerX > deadzone,
      handbrake: kb.handbrake || handbrake,
      useItem: kb.useItem || useItem,
      pause: kb.pause || pause,
      steerX: Math.abs(steerX) > deadzone ? steerX : kb.steerX,
      accel: Math.max(kb.accel, accel),
      brake: Math.max(kb.brake, brake),
    };
  }

  private emptyState(): InputState {
    return {
      forward: false, backward: false, left: false, right: false,
      handbrake: false, useItem: false, pause: false,
      steerX: 0, accel: 0, brake: 0,
    };
  }
}
