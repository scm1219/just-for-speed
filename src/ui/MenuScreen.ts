import { Difficulty } from '../ai/RubberBanding';

interface TrackInfo {
  id: string;
  name: string;
  color: string;
}

const TRACKS: TrackInfo[] = [
  { id: 'city', name: '城市街道', color: '#16c79a' },
  { id: 'coast', name: '海岸公路', color: '#1e90ff' },
  { id: 'desert', name: '沙漠峡谷', color: '#f5a623' },
];

const DIFFICULTIES: { value: Difficulty; label: string }[] = [
  { value: 'easy', label: 'Easy' },
  { value: 'normal', label: 'Normal' },
  { value: 'hard', label: 'Hard' },
];

export class MenuScreen {
  private element: HTMLElement;
  private selectedTrack: string = 'city';
  private selectedDifficulty: Difficulty = 'normal';
  private onStart: (trackId: string, difficulty: Difficulty) => void;

  constructor(onStart: (trackId: string, difficulty: Difficulty) => void) {
    this.onStart = onStart;

    this.element = document.createElement('div');
    this.element.id = 'menu-screen';

    const trackCardsHtml = TRACKS.map(
      (t) => `
      <div class="menu-track-card ${t.id === this.selectedTrack ? 'active' : ''}"
           data-track="${t.id}"
           style="border-color: ${t.color}; ${t.id === this.selectedTrack ? `background: ${t.color}22;` : ''}">
        <div class="menu-track-color" style="background: ${t.color};"></div>
        <div class="menu-track-name">${t.name}</div>
      </div>
    `
    ).join('');

    const diffButtonsHtml = DIFFICULTIES.map(
      (d) => `
      <button class="menu-diff-btn ${d.value === this.selectedDifficulty ? 'active' : ''}"
              data-diff="${d.value}">
        ${d.label}
      </button>
    `
    ).join('');

    this.element.innerHTML = `
      <style>
        #menu-screen {
          position: fixed; top: 0; left: 0; width: 100%; height: 100%;
          background: linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%);
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          z-index: 300; font-family: 'Segoe UI', sans-serif; color: #fff;
        }
        .menu-title {
          font-size: 64px; font-weight: bold; margin-bottom: 40px;
          background: linear-gradient(to right, #f5a623, #e94560, #16c79a);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          background-clip: text; letter-spacing: 4px;
        }
        .menu-section-label {
          font-size: 12px; color: #888; text-transform: uppercase;
          letter-spacing: 2px; margin-bottom: 12px;
        }
        .menu-track-cards {
          display: flex; gap: 16px; margin-bottom: 32px;
        }
        .menu-track-card {
          width: 140px; padding: 16px; border-radius: 10px;
          border: 2px solid #333; background: rgba(255,255,255,0.05);
          cursor: pointer; text-align: center; transition: all 0.2s;
        }
        .menu-track-card:hover { transform: translateY(-2px); }
        .menu-track-card.active { border-width: 2px; }
        .menu-track-color {
          width: 40px; height: 40px; border-radius: 50%; margin: 0 auto 8px;
        }
        .menu-track-name { font-size: 14px; font-weight: bold; }
        .menu-diff-buttons {
          display: flex; gap: 8px; margin-bottom: 40px;
        }
        .menu-diff-btn {
          padding: 8px 24px; border: 2px solid #555; border-radius: 6px;
          background: transparent; color: #aaa; font-size: 14px;
          cursor: pointer; transition: all 0.2s; font-weight: bold;
        }
        .menu-diff-btn:hover { border-color: #888; color: #fff; }
        .menu-diff-btn.active {
          border-color: #e94560; color: #e94560;
          background: rgba(233, 69, 96, 0.15);
        }
        .menu-start-btn {
          padding: 16px 64px; font-size: 22px; font-weight: bold;
          border: none; border-radius: 10px; cursor: pointer;
          background: linear-gradient(135deg, #e94560, #c0392b);
          color: #fff; letter-spacing: 2px; transition: transform 0.2s;
        }
        .menu-start-btn:hover { transform: scale(1.05); }
        .menu-start-btn:active { transform: scale(0.98); }
      </style>
      <div class="menu-title">JUST FOR SPEED</div>
      <div class="menu-section-label">Select Track</div>
      <div class="menu-track-cards">${trackCardsHtml}</div>
      <div class="menu-section-label">Difficulty</div>
      <div class="menu-diff-buttons">${diffButtonsHtml}</div>
      <button class="menu-start-btn">START</button>
    `;

    this.bindEvents();
    document.body.appendChild(this.element);
  }

  private bindEvents(): void {
    this.element.querySelectorAll('.menu-track-card').forEach((card) => {
      card.addEventListener('click', () => {
        const trackId = (card as HTMLElement).dataset.track!;
        this.selectTrack(trackId);
      });
    });

    this.element.querySelectorAll('.menu-diff-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const diff = (btn as HTMLElement).dataset.diff as Difficulty;
        this.selectDifficulty(diff);
      });
    });

    this.element.querySelector('.menu-start-btn')!.addEventListener('click', () => {
      this.element.remove();
      this.onStart(this.selectedTrack, this.selectedDifficulty);
    });
  }

  private selectTrack(trackId: string): void {
    this.selectedTrack = trackId;
    this.element.querySelectorAll('.menu-track-card').forEach((card) => {
      const id = (card as HTMLElement).dataset.track;
      const track = TRACKS.find((t) => t.id === id);
      if (id === trackId) {
        card.classList.add('active');
        (card as HTMLElement).style.background = `${track!.color}22`;
      } else {
        card.classList.remove('active');
        (card as HTMLElement).style.background = 'rgba(255,255,255,0.05)';
      }
    });
  }

  private selectDifficulty(difficulty: Difficulty): void {
    this.selectedDifficulty = difficulty;
    this.element.querySelectorAll('.menu-diff-btn').forEach((btn) => {
      const d = (btn as HTMLElement).dataset.diff;
      if (d === difficulty) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }
}
