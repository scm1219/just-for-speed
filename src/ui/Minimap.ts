import { TrackMesh } from '../rendering/TrackMesh';
import { Vehicle } from '../physics/Vehicle';

export class Minimap {
  private container: HTMLElement;
  private playerDot: SVGCircleElement;
  private aiDots: SVGCircleElement[] = [];

  constructor(container: HTMLElement, trackMesh: TrackMesh, aiCount: number) {
    this.container = container;
    const points = trackMesh.curve.getPoints(100);
    let pathD = `M ${(points[0].x * 0.5 + 50).toFixed(1)} ${(points[0].z * 0.5 + 50).toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
      pathD += ` L ${(points[i].x * 0.5 + 50).toFixed(1)} ${(points[i].z * 0.5 + 50).toFixed(1)}`;
    }
    pathD += ' Z';

    container.innerHTML = `
      <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <path d="${pathD}" fill="none" stroke="#444" stroke-width="1.5"/>
        <circle id="minimap-player" cx="50" cy="50" r="2.5" fill="#f5a623"/>
      </svg>
    `;
    const svg = container.querySelector('svg')!;
    this.playerDot = svg.querySelector('#minimap-player')!;

    for (let i = 0; i < aiCount; i++) {
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('r', '2');
      dot.setAttribute('fill', '#e94560');
      svg.appendChild(dot);
      this.aiDots.push(dot);
    }
  }

  update(playerVehicle: Vehicle, aiVehicles: Vehicle[]): void {
    const pPos = playerVehicle.getPosition();
    this.playerDot.setAttribute('cx', (pPos.x * 0.5 + 50).toFixed(1));
    this.playerDot.setAttribute('cy', (pPos.z * 0.5 + 50).toFixed(1));

    for (let i = 0; i < aiVehicles.length && i < this.aiDots.length; i++) {
      const pos = aiVehicles[i].getPosition();
      this.aiDots[i].setAttribute('cx', (pos.x * 0.5 + 50).toFixed(1));
      this.aiDots[i].setAttribute('cy', (pos.z * 0.5 + 50).toFixed(1));
    }
  }
}
