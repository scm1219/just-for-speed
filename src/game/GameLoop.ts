export interface Updatable {
  update(dt: number, totalTime: number): void;
  fixedUpdate(dt: number): void;
}

export class GameLoop {
  private updatables: Updatable[] = [];
  private lastTime: number = 0;
  private accumulator: number = 0;
  private readonly fixedDt: number = 1 / 60;
  private running: boolean = false;
  private animationId: number = 0;

  addSystem(system: Updatable): void {
    this.updatables.push(system);
  }

  removeSystem(system: Updatable): void {
    const idx = this.updatables.indexOf(system);
    if (idx !== -1) this.updatables.splice(idx, 1);
  }

  start(): void {
    this.running = true;
    this.lastTime = performance.now();
    this.loop();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.animationId);
  }

  private loop(): void {
    if (!this.running) return;
    this.animationId = requestAnimationFrame(this.loop.bind(this));

    const now = performance.now();
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    if (dt > 0.1) dt = 0.1;

    this.accumulator += dt;

    while (this.accumulator >= this.fixedDt) {
      for (const sys of this.updatables) {
        sys.fixedUpdate(this.fixedDt);
      }
      this.accumulator -= this.fixedDt;
    }

    for (const sys of this.updatables) {
      sys.update(dt, now / 1000);
    }
  }
}
