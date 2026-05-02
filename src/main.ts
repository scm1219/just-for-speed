import { Scene } from './rendering/Scene';
import { Environment } from './rendering/Environment';
import { VehicleMesh } from './rendering/VehicleMesh';
import { TrackMesh, TrackData } from './rendering/TrackMesh';
import { Camera } from './rendering/Camera';
import { Effects } from './rendering/Effects';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { TrackCollider } from './physics/TrackCollider';
import { Vehicle, DEFAULT_VEHICLE_CONFIG } from './physics/Vehicle';
import { InputManager } from './input/InputManager';
import { GameManager } from './game/GameManager';
import { GamePhase } from './game/GameState';
import { TrackLoader } from './data/TrackLoader';
import { AIDriver } from './ai/AIDriver';
import { Difficulty } from './ai/RubberBanding';
import { LapTracker } from './game/LapTracker';
import { ItemManager } from './items/ItemManager';
import { ItemType, applyItemEffect } from './items/ItemEffects';
import { HUD } from './ui/HUD';
import { Minimap } from './ui/Minimap';
import { MenuScreen } from './ui/MenuScreen';
import { ResultScreen, RaceResult } from './ui/ResultScreen';
import { AudioManager } from './audio/AudioManager';
import { ScoreManager } from './game/ScoreManager';
import * as THREE from 'three';

// --- Persistent singletons (survive race restarts) ---
const scene = new Scene();
scene.init();
const environment = new Environment(scene.threeScene);
environment.setup();
const input = new InputManager();
input.init();
const scoreManager = new ScoreManager();

// --- Race-scoped state (cleaned up between races) ---
let physics: PhysicsWorld | null = null;
let game: GameManager | null = null;
let playerVehicle: Vehicle | null = null;
let playerVehicleMesh: VehicleMesh | null = null;
let camera: Camera | null = null;
let trackMesh: TrackMesh | null = null;
let trackCollider: TrackCollider | null = null;
let aiDrivers: AIDriver[] = [];
let aiVehicleMeshes: VehicleMesh[] = [];
let lapTracker: LapTracker | null = null;
let itemManager: ItemManager | null = null;
let hud: HUD | null = null;
let minimap: Minimap | null = null;
let audioManager: AudioManager | null = null;
let effects: Effects | null = null;

let heldItem: ItemType | null = null;
let currentTrackId: string | null = null;
let currentDifficulty: Difficulty = 'normal';
let animationId: number = 0;
let lastRaceTime: number = 0;

// Pause overlay element
let pauseOverlay: HTMLElement | null = null;

function createPauseOverlay(): void {
  if (pauseOverlay) return;
  pauseOverlay = document.createElement('div');
  pauseOverlay.id = 'pause-overlay';
  pauseOverlay.innerHTML = `
    <style>
      #pause-overlay {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.6); display: none; flex-direction: column;
        align-items: center; justify-content: center; z-index: 250;
        font-family: 'Segoe UI', sans-serif; color: #fff;
      }
      #pause-overlay.visible { display: flex; }
      .pause-title { font-size: 48px; font-weight: bold; margin-bottom: 24px; }
      .pause-hint { font-size: 16px; color: #aaa; }
    </style>
    <div class="pause-title">PAUSED</div>
    <div class="pause-hint">Press ESC to resume</div>
  `;
  document.body.appendChild(pauseOverlay);
}

function cleanupRace(): void {
  cancelAnimationFrame(animationId);

  if (game) {
    game.loop.stop();
    game = null;
  }

  // Destroy AI vehicles and meshes
  for (let i = aiDrivers.length - 1; i >= 0; i--) {
    if (physics) {
      aiDrivers[i].vehicle.destroy(physics.world);
    }
    scene.threeScene.remove(aiVehicleMeshes[i].group);
  }
  aiDrivers = [];
  aiVehicleMeshes = [];

  // Destroy player vehicle and mesh
  if (playerVehicle && physics) {
    playerVehicle.destroy(physics.world);
  }
  if (playerVehicleMesh) {
    scene.threeScene.remove(playerVehicleMesh.group);
  }
  playerVehicle = null;
  playerVehicleMesh = null;
  camera = null;

  // Remove track
  if (trackMesh) {
    const trackGroup = (trackMesh as unknown as { group: THREE.Group }).group;
    scene.threeScene.remove(trackGroup);
  }
  trackMesh = null;
  trackCollider = null;

  // Clean physics
  if (physics) {
    // Physics world is garbage collected
    physics = null;
  }

  lapTracker = null;
  itemManager = null;
  heldItem = null;

  if (hud) {
    hud.hide();
    hud = null;
  }

  minimap = null;

  if (audioManager) {
    audioManager.stopEngine();
    audioManager = null;
  }

  if (effects) {
    effects = null;
  }

  if (pauseOverlay) {
    pauseOverlay.classList.remove('visible');
  }

  lastRaceTime = 0;
}

async function startRace(trackId: string, difficulty: Difficulty): Promise<void> {
  // Clean any previous race
  cleanupRace();

  currentTrackId = trackId;
  currentDifficulty = difficulty;

  // Load track data
  const trackLoader = new TrackLoader();
  const trackData: TrackData = await trackLoader.load(trackId);

  // Set up physics
  physics = new PhysicsWorld();

  // Set up game loop
  game = new GameManager();
  game.loop.addSystem(physics);

  // Build track mesh and add to scene
  trackMesh = new TrackMesh(trackData);
  const trackGroup = trackMesh.build();
  scene.threeScene.add(trackGroup);

  // Build track collider
  trackCollider = new TrackCollider();
  trackCollider.build(trackMesh, physics.world);

  // Create AI drivers (5 AI with staggered positions)
  aiDrivers = [];
  aiVehicleMeshes = [];
  const aiColors = [0x3498db, 0x2ecc71, 0xf39c12, 0x9b59b6, 0xe74c3c];
  for (let i = 0; i < 5; i++) {
    const ai = new AIDriver(physics.world, trackMesh, difficulty);
    // Stagger AI behind the player at different track positions
    const startT = ((1 - (i + 1) * 0.03) + 1) % 1; // slightly behind start
    ai.setPosition(startT);
    aiDrivers.push(ai);
    const mesh = new VehicleMesh(aiColors[i]);
    scene.threeScene.add(mesh.group);
    aiVehicleMeshes.push(mesh);
  }

  // Create player vehicle at start position (derived from track curve)
  const startPoint = trackMesh.getPointAt(0);
  const startTangent = trackMesh.getTangentAt(0);
  const startAngle = Math.atan2(startTangent.x, startTangent.z);

  playerVehicle = new Vehicle(DEFAULT_VEHICLE_CONFIG, physics.world);
  playerVehicle.chassisBody.position.set(
    startPoint.x,
    startPoint.y + 0.8,
    startPoint.z,
  );
  playerVehicle.chassisBody.quaternion.setFromEuler(0, startAngle, 0);

  playerVehicleMesh = new VehicleMesh(0xe94560);
  scene.threeScene.add(playerVehicleMesh.group);

  // Camera
  camera = new Camera(scene.threeCamera);

  // Effects
  effects = new Effects(scene.threeScene);

  // Lap tracker - add all racers
  lapTracker = new LapTracker(trackMesh, trackData.checkpoints, trackData.totalLaps);
  lapTracker.addRacer(playerVehicle, true);
  for (const ai of aiDrivers) {
    lapTracker.addRacer(ai.vehicle, false);
  }

  // Item manager
  itemManager = new ItemManager(trackMesh, trackData.itemBoxPositions);
  const itemMeshes = itemManager.getMeshes();
  for (const mesh of itemMeshes) {
    scene.threeScene.add(mesh);
  }

  // HUD
  hud = new HUD();
  hud.show();

  // Minimap
  const minimapContainer = document.getElementById('hud-minimap');
  if (minimapContainer) {
    minimap = new Minimap(minimapContainer, trackMesh, 5);
  }

  // Audio
  audioManager = new AudioManager();
  audioManager.init();
  audioManager.startEngine();

  // Create pause overlay if needed
  createPauseOverlay();

  // Start countdown (render immediately, physics after countdown)
  game.setPhase(GamePhase.COUNTDOWN);
  lastRaceTime = performance.now() / 1000;
  renderLoop();
  runCountdown();
}

function runCountdown(): void {
  let count = 3;
  const countdownInterval = setInterval(() => {
    if (audioManager) audioManager.playCountdown();
    if (hud) hud.showNotification(count.toString());
    count--;
    if (count <= 0) {
      clearInterval(countdownInterval);
      // GO!
      if (audioManager) audioManager.playGo();
      if (hud) hud.showNotification('GO!');
      if (game) game.setPhase(GamePhase.RACING);
      if (lapTracker) lapTracker.startRace(performance.now() / 1000);
      // Start the physics loop (render loop already running)
      lastRaceTime = performance.now() / 1000;
      if (game) game.loop.start();
    }
  }, 1000);
}

function renderLoop(): void {
  if (!game || !physics || !playerVehicle || !playerVehicleMesh || !camera || !trackMesh || !lapTracker || !hud) return;

  animationId = requestAnimationFrame(renderLoop);

  const now = performance.now() / 1000;
  const dt = Math.min(now - lastRaceTime, 0.1);
  lastRaceTime = now;

  // Always update input
  input.update();
  const currentInput = input.getInput();

  // Handle pause toggle
  if (currentInput.pause && game.state.phase === GamePhase.RACING) {
    game.setPhase(GamePhase.PAUSED);
    if (pauseOverlay) pauseOverlay.classList.add('visible');
    if (audioManager) audioManager.stopEngine();
    return;
  } else if (currentInput.pause && game.state.phase === GamePhase.PAUSED) {
    game.setPhase(GamePhase.RACING);
    if (pauseOverlay) pauseOverlay.classList.remove('visible');
    if (audioManager) audioManager.startEngine();
    lastRaceTime = performance.now() / 1000;
    return;
  }

  // Only update game systems during RACING phase
  if (game.state.phase === GamePhase.RACING) {
    // Update player vehicle from input
    playerVehicle.updateFromInput(currentInput, dt);

    // Check drifting for effects and audio
    if (playerVehicle.getIsDrifting()) {
      if (effects) {
        const pos = playerVehicle.getPosition();
        effects.emitSmoke(new THREE.Vector3(pos.x, pos.y, pos.z));
      }
      if (audioManager) audioManager.playDrift();
    }

    // Update AI drivers
    const { t: playerProgress, closestDist } = getPlayerApproxProgress();
    for (const ai of aiDrivers) {
      ai.update(playerProgress, dt);
    }

    // Out-of-bounds detection and reset
    const OOB_Y_MIN = -15;
    const OOB_Y_MAX = 50;
    const OOB_MAX_DIST = trackMesh.trackData.roadWidth / 2 + 5;
    const playerPos = playerVehicle.getPosition();
    if (playerPos.y < OOB_Y_MIN || playerPos.y > OOB_Y_MAX || closestDist > OOB_MAX_DIST) {
      resetPlayerToTrack(playerProgress);
    }

    // Flip detection and auto-reset
    playerVehicle.checkFlipState();
    const flipStatus = playerVehicle.getFlipStatus();
    if (flipStatus.flipped) {
      const remaining = Math.ceil(5 - flipStatus.elapsed);
      if (remaining > 0) {
        hud.showNotification(`翻车！${remaining}秒后回正`);
      }
      if (flipStatus.elapsed >= 5 || currentInput.resetVehicle) {
        resetPlayerToTrack(playerProgress);
        playerVehicle.clearFlipState();
      }
    }

    // Update lap tracker
    lapTracker.update(now);

    // Check race completion
    if (lapTracker.isRaceComplete()) {
      onRaceComplete();
      return;
    }

    // Update items
    if (itemManager) {
      const playerPos = playerVehicle.getPosition();
      const pickedItem = itemManager.update(now, { x: playerPos.x, y: playerPos.y, z: playerPos.z }, heldItem);
      if (pickedItem !== null) {
        heldItem = pickedItem;
        if (hud) hud.updateItem(heldItem);
        if (audioManager) audioManager.playPickup();
      }
    }

    // Handle item usage
    if (currentInput.useItem && heldItem !== null) {
      const allAIVehicles = aiDrivers.map(ai => ai.vehicle);
      const result = applyItemEffect(heldItem, playerVehicle, allAIVehicles);
      if (hud) hud.showNotification(result.message);
      if (audioManager) audioManager.playUseItem();
      heldItem = null;
      if (hud) hud.updateItem(null);
    }

    // Update HUD
    const standings = lapTracker.getStandings();
    const playerState = lapTracker.getPlayerState();
    if (playerState) {
      const position = standings.findIndex(s => s.isPlayer) + 1;
      hud.updatePosition(position, standings.length);
      hud.updateLap(playerState.currentLap, playerState.totalLaps);
      const raceTime = now - playerState.raceStartTime;
      hud.updateTime(raceTime);
    }
    hud.updateSpeed(playerVehicle.getSpeedKmh(), 200);

    // Update minimap
    if (minimap) {
      minimap.update(playerVehicle, aiDrivers.map(ai => ai.vehicle));
    }

    // Update audio
    if (audioManager) {
      audioManager.updateEngineSpeed(playerVehicle.getSpeedKmh());
    }
  }

  // Sync all meshes with physics
  const pos = playerVehicle.getPosition();
  const quat = playerVehicle.getQuaternion();
  playerVehicleMesh.updateFromPhysics(pos, quat);

  for (let i = 0; i < aiDrivers.length; i++) {
    const aiPos = aiDrivers[i].vehicle.getPosition();
    const aiQuat = aiDrivers[i].vehicle.getQuaternion();
    aiVehicleMeshes[i].updateFromPhysics(aiPos, aiQuat);
  }

  // Update camera
  camera.update(pos, quat, dt);

  // Update effects
  if (effects) effects.update(dt);

  // Render
  scene.threeRenderer.render(scene.threeScene, scene.threeCamera);
}

function getPlayerApproxProgress(): { t: number; closestDist: number } {
  if (!playerVehicle || !trackMesh) return { t: 0, closestDist: 0 };
  const pos = playerVehicle.getPosition();
  const playerVec = new THREE.Vector3(pos.x, pos.y, pos.z);
  let closestT = 0;
  let closestDist = Infinity;
  for (let i = 0; i <= 100; i++) {
    const t = i / 100;
    const point = trackMesh.getPointAt(t);
    const dist = playerVec.distanceTo(point);
    if (dist < closestDist) {
      closestDist = dist;
      closestT = t;
    }
  }
  return { t: closestT, closestDist };
}

function resetPlayerToTrack(nearestT: number): void {
  if (!playerVehicle || !trackMesh || !hud) return;
  const point = trackMesh.getPointAt(nearestT);
  const tangent = trackMesh.getTangentAt(nearestT);
  const angle = Math.atan2(tangent.x, tangent.z);

  playerVehicle.chassisBody.position.set(point.x, point.y + 0.8, point.z);
  playerVehicle.chassisBody.quaternion.setFromEuler(0, angle, 0);
  playerVehicle.chassisBody.velocity.set(0, 0, 0);
  playerVehicle.chassisBody.angularVelocity.set(0, 0, 0);

  hud.showNotification('Reset!');
}

function onRaceComplete(): void {
  if (!lapTracker || !playerVehicle || !game || !currentTrackId) return;

  game.setPhase(GamePhase.RESULTS);
  game.loop.stop();

  if (audioManager) audioManager.stopEngine();

  const playerState = lapTracker.getPlayerState();
  if (!playerState) return;

  const standings = lapTracker.getStandings();
  const position = standings.findIndex(s => s.isPlayer) + 1;
  const totalTime = playerState.lapTimes.reduce((sum, t) => sum + t, 0);
  const bestLap = playerState.lapTimes.length > 0
    ? Math.min(...playerState.lapTimes)
    : totalTime;

  // Update scores
  const score = scoreManager.updateScore(currentTrackId, currentDifficulty, totalTime, bestLap);

  const result: RaceResult = {
    position,
    totalRacers: standings.length,
    totalLapTimes: playerState.lapTimes,
    bestLap,
    totalTime,
    trackBestTotal: score.bestTotalTime,
    trackBestLap: score.bestLapTime,
  };

  new ResultScreen(
    result,
    () => {
      // Restart same track
      if (currentTrackId) {
        startRace(currentTrackId, currentDifficulty);
      }
    },
    () => {
      // Back to menu
      cleanupRace();
      showMenu();
    },
  );
}

function showMenu(): void {
  new MenuScreen((trackId, difficulty) => {
    startRace(trackId, difficulty);
  });
}

// --- Boot ---
showMenu();

// Keep rendering the background scene even on menu
function menuRenderLoop(): void {
  requestAnimationFrame(menuRenderLoop);
  if (!game || game.state.phase === GamePhase.MENU || game.state.phase === GamePhase.TRACK_SELECT) {
    scene.threeRenderer.render(scene.threeScene, scene.threeCamera);
  }
}
menuRenderLoop();
