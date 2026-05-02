export interface RaceResult {
  position: number;
  totalRacers: number;
  totalLapTimes: number[];
  bestLap: number;
  totalTime: number;
  trackBestTotal: number | null;
  trackBestLap: number | null;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs.toFixed(2)}`;
}

function getPositionSuffix(position: number): string {
  if (position === 1) return 'st';
  if (position === 2) return 'nd';
  if (position === 3) return 'rd';
  return 'th';
}

export class ResultScreen {
  private element: HTMLElement;
  private result: RaceResult;
  private onRestart: () => void;
  private onMenu: () => void;

  constructor(result: RaceResult, onRestart: () => void, onMenu: () => void) {
    this.result = result;
    this.onRestart = onRestart;
    this.onMenu = onMenu;

    this.element = document.createElement('div');
    this.element.id = 'result-screen';

    const isNewBestTotal =
      result.trackBestTotal === null || result.totalTime < result.trackBestTotal;
    const isNewBestLap =
      result.trackBestLap === null || result.bestLap < result.trackBestLap;

    const lapRows = result.totalLapTimes
      .map(
        (t, i) => `
      <div class="result-lap-row">
        <span class="result-lap-label">Lap ${i + 1}</span>
        <span class="result-lap-time">${formatTime(t)}</span>
        ${t === result.bestLap && isNewBestLap ? '<span class="result-new-record">NEW RECORD!</span>' : ''}
      </div>
    `
      )
      .join('');

    this.element.innerHTML = `
      <style>
        #result-screen {
          position: fixed; top: 0; left: 0; width: 100%; height: 100%;
          background: linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%);
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          z-index: 300; font-family: 'Segoe UI', sans-serif; color: #fff;
        }
        .result-position {
          font-size: 72px; font-weight: bold; margin-bottom: 8px;
        }
        .result-position-suffix {
          font-size: 32px; color: #888; vertical-align: super;
        }
        .result-subtitle {
          font-size: 16px; color: #888; margin-bottom: 32px;
        }
        .result-stats {
          background: rgba(255,255,255,0.08); border-radius: 12px;
          padding: 24px 32px; margin-bottom: 24px; min-width: 320px;
        }
        .result-stat-row {
          display: flex; justify-content: space-between; align-items: center;
          padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .result-stat-row:last-child { border-bottom: none; }
        .result-stat-label { color: #888; font-size: 13px; }
        .result-stat-value { font-size: 16px; font-weight: bold; }
        .result-new-record {
          color: #f5a623; font-size: 11px; font-weight: bold;
          animation: pulse 1s ease-in-out infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .result-lap-section {
          font-size: 12px; color: #666; text-transform: uppercase;
          letter-spacing: 1px; margin-bottom: 8px;
        }
        .result-lap-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 4px 0; font-size: 13px;
        }
        .result-lap-label { color: #888; }
        .result-lap-time { font-weight: bold; }
        .result-buttons {
          display: flex; gap: 16px; margin-top: 24px;
        }
        .result-btn {
          padding: 12px 32px; font-size: 16px; font-weight: bold;
          border: none; border-radius: 8px; cursor: pointer; color: #fff;
          transition: transform 0.2s;
        }
        .result-btn:hover { transform: scale(1.05); }
        .result-btn:active { transform: scale(0.98); }
        .result-restart-btn { background: #e94560; }
        .result-menu-btn { background: #555; }
      </style>
      <div class="result-position">
        ${result.position}<span class="result-position-suffix">${getPositionSuffix(result.position)}</span>
      </div>
      <div class="result-subtitle">of ${result.totalRacers} racers</div>
      <div class="result-stats">
        <div class="result-stat-row">
          <span class="result-stat-label">Total Time</span>
          <span class="result-stat-value">${formatTime(result.totalTime)}</span>
          ${isNewBestTotal ? '<span class="result-new-record">NEW RECORD!</span>' : ''}
        </div>
        <div class="result-stat-row">
          <span class="result-stat-label">Best Lap</span>
          <span class="result-stat-value">${formatTime(result.bestLap)}</span>
          ${isNewBestLap ? '<span class="result-new-record">NEW RECORD!</span>' : ''}
        </div>
      </div>
      <div class="result-lap-section">Lap Times</div>
      <div class="result-stats" style="padding: 16px 32px;">
        ${lapRows}
      </div>
      <div class="result-buttons">
        <button class="result-btn result-restart-btn">Race Again</button>
        <button class="result-btn result-menu-btn">Menu</button>
      </div>
    `;

    this.element.querySelector('.result-restart-btn')!.addEventListener('click', () => {
      this.element.remove();
      this.onRestart();
    });

    this.element.querySelector('.result-menu-btn')!.addEventListener('click', () => {
      this.element.remove();
      this.onMenu();
    });

    document.body.appendChild(this.element);
  }
}
