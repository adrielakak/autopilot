import { lazy, Suspense, useState } from 'react';
import {
  Activity,
  Box,
  Crosshair,
  Eye,
  FastForward,
  Flag,
  Layers,
  Pause,
  Play,
  Radar,
  RotateCcw,
  SkipForward,
  Users,
} from 'lucide-react';
import { Canvas2DView } from './components/Canvas2DView';
import { FitnessChart } from './components/FitnessChart';
import { LidarPanel } from './components/LidarPanel';
import ClickSpark from './components/reactbits/ClickSpark/ClickSpark';
import CountUp from './components/reactbits/CountUp/CountUp';
import ShapeGrid from './components/reactbits/ShapeGrid/ShapeGrid';
import ShinyText from './components/reactbits/ShinyText/ShinyText';
import SpotlightCard from './components/reactbits/SpotlightCard/SpotlightCard';
import { useSimulationSocket } from './hooks/useSimulationSocket';

const Scene3DView = lazy(() =>
  import('./components/Scene3DView').then((mod) => ({ default: mod.Scene3DView })),
);

type ViewMode = '2d' | '3d';
const SPEED_OPTIONS = [1, 2, 5, 10] as const;

const STATUS_META = {
  STOPPING: { label: 'Freinage actif', color: 'text-rose-400', dot: 'bg-rose-400' },
  STOP_DONE: { label: 'STOP validé', color: 'text-emerald-400', dot: 'bg-emerald-400' },
  CRUISING: { label: 'Navigation NEAT', color: 'text-cyan-400', dot: 'bg-cyan-400' },
} as const;

const CONNECTION_LABEL = {
  connected: { text: 'Flux actif', color: 'text-emerald-400', dot: 'bg-emerald-400' },
  connecting: { text: 'Connexion...', color: 'text-amber-400', dot: 'bg-amber-400' },
  disconnected: { text: 'Hors ligne', color: 'text-rose-400', dot: 'bg-rose-400' },
} as const;

export function App() {
  const { uiState, mapData, stateRef, mapRef, status, fps, sendCommand } =
    useSimulationSocket();

  const [viewMode, setViewMode] = useState<ViewMode>('2d');
  const [showLidar, setShowLidar] = useState(true);
  const [showGhosts, setShowGhosts] = useState(true);
  const [followCamera, setFollowCamera] = useState(false);

  const generation = uiState?.generation ?? 1;
  const populationSize = uiState?.populationSize ?? 50;
  const alive = uiState?.alive ?? 0;
  const paused = uiState?.paused ?? false;
  const speedMultiplier = uiState?.speedMultiplier ?? 1;
  const speciesCount = uiState?.speciesCount ?? 1;
  const allTimeBestFitness = uiState?.allTimeBestFitness ?? 0;
  const bestCar = uiState?.bestCar ?? null;

  const totalCheckpoints = mapData?.checkpoints.length ?? 13;
  const checkpointsPassed = bestCar?.checkpoints ?? 0;
  const lapCheckpoints = checkpointsPassed % totalCheckpoints;
  const currentLap = (bestCar?.laps ?? 0) + 1;

  const speedKmh = bestCar ? Math.abs(bestCar.speed) * 12 : 0;
  const isReverse = bestCar ? bestCar.speed < -0.05 : false;
  const steeringDeg = bestCar ? bestCar.steering * 28 : 0;

  const statusMeta = bestCar ? STATUS_META[bestCar.status] : STATUS_META.CRUISING;
  const connMeta = CONNECTION_LABEL[status];

  return (
    <ClickSpark
      sparkColor="#00e5ff"
      sparkSize={7}
      sparkRadius={16}
      sparkCount={6}
      duration={280}
      className="min-h-screen w-full bg-[#09090b]"
    >
      <div className="flex min-h-screen flex-col bg-[#09090b] text-zinc-100 lg:h-screen lg:overflow-hidden">
        {/* Barre supérieure compacte (h-14, style Linear/Raycast sans pilules IA) */}
        <header className="z-20 flex h-14 shrink-0 items-center justify-between border-b border-white/[0.08] bg-[#09090b]/90 px-5 backdrop-blur-xl">
          <div className="flex items-center gap-6">
            {/* Marque vectorielle sur mesure + wordmark typographique */}
            <div className="flex items-center gap-2.5">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                className="shrink-0 text-cyan-400"
              >
                <path
                  d="M4 17L10.5 5H14.5L20 17"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M7.5 13.5H16.5"
                  stroke="#f4f4f5"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
                <circle cx="19" cy="6.5" r="2" fill="currentColor" />
              </svg>
              <div className="flex items-baseline gap-2">
                <span className="text-[15px] font-semibold tracking-[-0.03em] text-zinc-100">
                  AutoPilot
                </span>
                <span className="font-mono text-[10px] font-medium tracking-wider text-zinc-500">
                  FSD · NEAT
                </span>
              </div>
            </div>

            <div className="hidden h-4 w-px bg-white/[0.08] sm:block" />

            {/* Onglets text-only épurés (zéro bulles grises) */}
            <nav aria-label="Mode de rendu" className="flex h-14 items-center gap-5">
              <button
                type="button"
                onClick={() => setViewMode('2d')}
                className={`relative flex h-full cursor-pointer items-center gap-1.5 text-xs font-medium transition-colors duration-150 ${
                  viewMode === '2d'
                    ? 'text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                <span>2D Télémétrie</span>
                {viewMode === '2d' && (
                  <span className="absolute inset-x-0 bottom-0 h-[2px] bg-cyan-400" />
                )}
              </button>

              <button
                type="button"
                onClick={() => setViewMode('3d')}
                className={`relative flex h-full cursor-pointer items-center gap-1.5 text-xs font-medium transition-colors duration-150 ${
                  viewMode === '3d'
                    ? 'text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Box className="h-3.5 w-3.5" />
                <span>3D WebGL</span>
                {viewMode === '3d' && (
                  <span className="absolute inset-x-0 bottom-0 h-[2px] bg-cyan-400" />
                )}
              </button>
            </nav>

            <div className="hidden h-4 w-px bg-white/[0.08] md:block" />

            {/* Calques text-only */}
            <div className="hidden items-center gap-4 md:flex">
              <button
                type="button"
                onClick={() => setShowLidar((v) => !v)}
                className={`flex cursor-pointer items-center gap-1.5 text-xs font-medium transition-colors duration-150 ${
                  showLidar ? 'text-cyan-300' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <Radar className="h-3.5 w-3.5" />
                <span>LIDAR</span>
              </button>

              <button
                type="button"
                onClick={() => setShowGhosts((v) => !v)}
                className={`flex cursor-pointer items-center gap-1.5 text-xs font-medium transition-colors duration-150 ${
                  showGhosts ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <Eye className="h-3.5 w-3.5" />
                <span>Essaim</span>
              </button>

              <button
                type="button"
                onClick={() => setFollowCamera((v) => !v)}
                className={`flex cursor-pointer items-center gap-1.5 text-xs font-medium transition-colors duration-150 ${
                  followCamera ? 'text-cyan-300' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <Crosshair className="h-3.5 w-3.5" />
                <span>Suivi caméra</span>
              </button>
            </div>
          </div>

          {/* Contrôles temps réel & statut connexion */}
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-1.5 border-r border-white/[0.08] pr-3 sm:flex">
              <span className={`h-1.5 w-1.5 rounded-full ${connMeta.dot}`} />
              <span className={`text-[11px] font-medium ${connMeta.color}`}>{connMeta.text}</span>
              {status === 'connected' && (
                <span className="font-mono text-[10px] text-zinc-500 tabular-nums">
                  {fps} FPS
                </span>
              )}
            </div>

            {/* Vitesse d'entraînement */}
            <div className="hidden items-center border border-white/[0.08] bg-white/[0.02] p-0.5 rounded-md sm:flex">
              <FastForward className="mx-1.5 h-3 w-3 text-zinc-500" />
              {SPEED_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => sendCommand({ action: 'set_speed', speed: opt })}
                  className={`cursor-pointer rounded px-1.5 py-0.5 font-mono text-[11px] tabular-nums transition-colors duration-150 active:scale-[0.98] ${
                    speedMultiplier === opt
                      ? 'bg-cyan-400/15 text-cyan-300'
                      : 'text-zinc-500 hover:text-zinc-200'
                  }`}
                >
                  {opt}×
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => sendCommand({ action: 'toggle_pause' })}
              className="flex cursor-pointer items-center gap-1.5 rounded-md border border-white/[0.1] bg-white/[0.03] px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition-colors duration-150 hover:bg-white/[0.07] active:scale-[0.98]"
            >
              {paused ? <Play className="h-3.5 w-3.5 text-cyan-400" /> : <Pause className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{paused ? 'Reprendre' : 'Pause'}</span>
            </button>

            <button
              type="button"
              onClick={() => sendCommand({ action: 'force_next_gen' })}
              title="Passer immédiatement à la génération suivante"
              className="flex cursor-pointer items-center gap-1.5 rounded-md border border-cyan-400/25 bg-cyan-400/10 px-2.5 py-1.5 text-xs font-medium text-cyan-300 transition-colors duration-150 hover:bg-cyan-400/15 active:scale-[0.98]"
            >
              <SkipForward className="h-3.5 w-3.5" />
              <span className="hidden md:inline">Gén. suivante</span>
            </button>

            <button
              type="button"
              onClick={() => sendCommand({ action: 'reset' })}
              title="Réinitialiser l'entraînement à la génération 1"
              className="flex cursor-pointer items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.02] p-1.5 text-zinc-400 transition-colors duration-150 hover:border-rose-400/30 hover:text-rose-300 active:scale-[0.98]"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>

        {/* Corps principal asymétrique */}
        <main className="flex flex-1 flex-col overflow-hidden lg:flex-row">
          {/* Scène principale 2D / 3D avec grille d'arrière-plan React Bits */}
          <section className="relative min-h-[460px] flex-1 overflow-hidden border-b border-white/[0.08] bg-[#08090d] lg:border-r lg:border-b-0">
            <div className="pointer-events-none absolute inset-0 z-0 opacity-60">
              <ShapeGrid
                shape="square"
                cellSize={46}
                lineWidth={0.6}
                direction="diagonal"
                speed={0.14}
                lineColor="rgba(255, 255, 255, 0.035)"
                hoverColor="rgba(0, 229, 255, 0.14)"
                hoverFillColor="rgba(0, 229, 255, 0.04)"
                fillOpacity={0.25}
                glow={0.1}
                opacity={0.75}
                paused={paused}
              />
            </div>

            {/* HUD discret flottant (angle supérieur gauche) */}
            <div className="pointer-events-none absolute top-4 left-4 z-10 flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 rounded-md border border-white/[0.08] bg-[#0c0d12]/80 px-3 py-1.5 backdrop-blur-md">
                <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dot}`} />
                <ShinyText
                  text={paused ? 'Simulation en pause' : statusMeta.label}
                  color="#d4d4d8"
                  shineColor="#00e5ff"
                  speed={3.2}
                  disabled={paused}
                  className="text-xs font-medium"
                />
              </div>

              {bestCar?.in_stop_zone && (
                <div className="rounded-md border border-rose-500/35 bg-rose-500/15 px-2.5 py-1.5 text-[11px] font-medium text-rose-300 backdrop-blur-md">
                  Zone STOP active
                </div>
              )}
            </div>

            {/* HUD Tour / Tick (angle supérieur droit) */}
            <div className="pointer-events-none absolute top-4 right-4 z-10 flex items-center gap-3 rounded-md border border-white/[0.08] bg-[#0c0d12]/80 px-3 py-1.5 font-mono text-[11px] text-zinc-400 backdrop-blur-md tabular-nums">
              <span>Tour {currentLap}</span>
              <span className="h-3 w-px bg-white/[0.1]" />
              <span>Tick {uiState?.ticks ?? 0}</span>
              <span className="h-3 w-px bg-white/[0.1]" />
              <span>{speciesCount} esp.</span>
            </div>

            {/* Légende minimale en bas à gauche */}
            <div className="pointer-events-none absolute bottom-4 left-4 z-10 hidden items-center gap-4 rounded-md border border-white/[0.07] bg-[#0c0d12]/80 px-3 py-1.5 text-[11px] text-zinc-400 backdrop-blur-md sm:flex">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-cyan-400" />
                Leader IA
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-cyan-400/30 ring-1 ring-cyan-400/50" />
                Essaim
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-amber-400" />
                Trafic NPC
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-rose-500" />
                STOP
              </span>
            </div>

            {/* Rendu actif */}
            <div className="relative z-[1] h-full w-full">
              {status !== 'connected' && !uiState ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center">
                  <Activity className="h-6 w-6 text-cyan-400" />
                  <p className="text-sm font-medium text-zinc-200">
                    En attente du serveur télémétrique (port 8000)
                  </p>
                  <p className="max-w-sm text-xs text-zinc-500">
                    Démarrez le moteur Python avec <code className="font-mono text-zinc-300">uvicorn main:app</code> pour lancer l&apos;entraînement NEAT.
                  </p>
                </div>
              ) : viewMode === '2d' ? (
                <Canvas2DView
                  stateRef={stateRef}
                  mapRef={mapRef}
                  showLidar={showLidar}
                  showGhosts={showGhosts}
                  followCamera={followCamera}
                />
              ) : (
                <Suspense
                  fallback={
                    <div className="flex h-full w-full items-center justify-center text-xs text-zinc-400">
                      Initialisation du moteur WebGL 3D...
                    </div>
                  }
                >
                  <Scene3DView
                    stateRef={stateRef}
                    mapData={mapData}
                    activeCheckpointIndex={lapCheckpoints}
                    showLidar={showLidar}
                    showGhosts={showGhosts}
                    followCamera={followCamera}
                  />
                </Suspense>
              )}
            </div>
          </section>

          {/* Panneau latéral de télémétrie */}
          <aside className="telemetry-scroll flex w-full shrink-0 flex-col gap-3.5 overflow-y-auto bg-[#0c0c0f] p-4 lg:w-[390px]">
            {/* Cartes maîtresses avec SpotlightCard + CountUp */}
            <div className="grid grid-cols-2 gap-3">
              <SpotlightCard
                spotlightColor="rgba(0, 229, 255, 0.14)"
                intensity={0.55}
                className="rounded-xl border border-white/[0.08] bg-[#111115] p-3.5"
              >
                <div className="flex items-center justify-between text-[11px] text-zinc-400">
                  <span>Génération</span>
                  <span className="font-mono text-[10px] text-cyan-400">NEAT</span>
                </div>
                <div className="mt-1.5 font-mono text-2xl font-semibold tracking-tight text-white tabular-nums">
                  <CountUp to={generation} duration={0.4} />
                </div>
                <p className="mt-1 text-[11px] text-zinc-500 tabular-nums">
                  Record : {allTimeBestFitness.toFixed(1)} pts
                </p>
              </SpotlightCard>

              <SpotlightCard
                spotlightColor="rgba(52, 211, 153, 0.14)"
                intensity={0.55}
                className="rounded-xl border border-white/[0.08] bg-[#111115] p-3.5"
              >
                <div className="flex items-center justify-between text-[11px] text-zinc-400">
                  <span>Flotte active</span>
                  <Users className="h-3.5 w-3.5 text-zinc-500" />
                </div>
                <div className="mt-1.5 flex items-baseline gap-1 font-mono text-2xl font-semibold tracking-tight text-white tabular-nums">
                  <span>{alive}</span>
                  <span className="text-sm font-normal text-zinc-500">/ {populationSize}</span>
                </div>
                <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full bg-emerald-400 transition-[width] duration-150"
                    style={{
                      width: `${populationSize > 0 ? Math.round((alive / populationSize) * 100) : 0}%`,
                    }}
                  />
                </div>
              </SpotlightCard>
            </div>

            {/* Dynamique véhicule */}
            <div className="rounded-xl border border-white/[0.08] bg-[#111115] p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-medium text-zinc-300">Dynamique du leader</h2>
                <span className={`text-[11px] font-medium ${statusMeta.color}`}>
                  {statusMeta.label}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
                  <div className="flex items-center justify-between text-[10px] text-zinc-500">
                    <span>Vitesse</span>
                    {isReverse && (
                      <span className="rounded bg-amber-500/15 px-1 font-mono text-[9px] text-amber-300">
                        AR
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-baseline gap-1 font-mono text-lg font-semibold text-white tabular-nums">
                    <span>{speedKmh.toFixed(0)}</span>
                    <span className="text-[11px] font-normal text-zinc-500">km/h</span>
                  </div>
                </div>

                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
                  <div className="flex items-center justify-between text-[10px] text-zinc-500">
                    <span>Braquage roues</span>
                  </div>
                  <div className="mt-1 flex items-baseline gap-1 font-mono text-lg font-semibold text-white tabular-nums">
                    <span>
                      {steeringDeg > 0 ? '+' : ''}
                      {steeringDeg.toFixed(1)}°
                    </span>
                  </div>
                </div>
              </div>

              {/* Jauge d'accélération / freinage */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px] text-zinc-500">
                  <span>Commande motrice</span>
                  <span className="font-mono text-zinc-300 tabular-nums">
                    {bestCar?.braking
                      ? 'Frein actif'
                      : `Gaz ${Math.round(Math.max(0, bestCar?.acceleration ?? 0) * 100)}%`}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className={`h-full rounded-full transition-[width] duration-150 ${
                      bestCar?.braking ? 'bg-rose-400' : 'bg-cyan-400'
                    }`}
                    style={{
                      width: `${Math.min(100, Math.round(Math.abs(bestCar?.acceleration ?? 0) * 100))}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Progression circuit & règle STOP */}
            <div className="rounded-xl border border-white/[0.08] bg-[#111115] p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
                  <Flag className="h-3.5 w-3.5 text-cyan-400" />
                  <span>Progression circuit</span>
                </h2>
                <span className="font-mono text-[11px] text-zinc-400 tabular-nums">
                  Fitness {bestCar?.fitness.toFixed(1) ?? '0.0'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
                  <span className="text-[10px] text-zinc-500">Checkpoints (tour)</span>
                  <div className="mt-1 flex items-baseline gap-1 font-mono text-lg font-semibold text-cyan-300 tabular-nums">
                    <span>{lapCheckpoints}</span>
                    <span className="text-xs font-normal text-zinc-500">/ {totalCheckpoints}</span>
                  </div>
                </div>

                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
                  <span className="text-[10px] text-zinc-500">Règle du STOP</span>
                  <div
                    className={`mt-1.5 text-xs font-medium ${
                      bestCar?.stop_rule_fulfilled ? 'text-emerald-400' : 'text-zinc-400'
                    }`}
                  >
                    {bestCar?.stop_rule_fulfilled ? 'Arrêt respecté' : 'En attente'}
                  </div>
                </div>
              </div>
            </div>

            {/* Évolution génétique NEAT */}
            <div className="rounded-xl border border-white/[0.08] bg-[#111115] p-3.5 space-y-2.5">
              <h2 className="text-xs font-medium text-zinc-300">Courbe d&apos;évolution</h2>
              <FitnessChart
                history={uiState?.history ?? []}
                allTimeBest={allTimeBestFitness}
              />
            </div>

            {/* Capteurs LIDAR 15 canaux */}
            <div className="rounded-xl border border-white/[0.08] bg-[#111115] p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-medium text-zinc-300">LIDAR sémantique</h2>
                <span className="font-mono text-[10px] text-zinc-500">5 × 3 canaux</span>
              </div>
              <LidarPanel lidar={bestCar?.lidar ?? []} />
            </div>
          </aside>
        </main>
      </div>
    </ClickSpark>
  );
}

export default App;
