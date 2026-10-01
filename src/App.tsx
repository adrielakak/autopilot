import React, { useEffect, useRef, useState, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Impact {
  wall: { x: number; y: number; dist: number };
  npc:  { x: number; y: number; dist: number };
  stop: { x: number; y: number; dist: number };
}

interface BestCar {
  x: number; y: number; angle: number;
  speed: number; braking: boolean; steering: number; acceleration: number;
  lidar: number[]; impacts: Impact[];
  fitness: number; checkpoints: number;
  stop_rule_fulfilled: boolean; in_stop_zone: boolean;
  status: 'CRUISING' | 'STOPPING' | 'STOP_DONE';
}

interface OtherCar { x: number; y: number; }

interface TrafficCar {
  x: number; y: number; angle: number;
  speed: number; width: number; height: number;
}

interface MapData {
  size: number; roadWidth: number;
  walls: [[number, number], [number, number]][];
  stopZone: { x: number; y: number; width: number; height: number };
  checkpoints: [[number, number], [number, number]][];
}

interface SimState {
  generation: number;
  alive: number;
  trafficCars: TrafficCar[];
  bestCar: BestCar;
  otherAiCars: OtherCar[];
  map: MapData;
}

// ─── Colour helpers ───────────────────────────────────────────────────────────

/** Maps a LIDAR distance (0‑150 px) to a traffic-light colour. */
const distColor = (d: number) => {
  if (d > 100) return '#22c55e';
  if (d > 60)  return '#eab308';
  if (d > 30)  return '#f97316';
  return '#ef4444';
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const LidarBar = ({ distance, label, range = 150 }: {
  distance: number; label: string; range?: number;
}) => {
  const pct   = Math.min(100, (distance / range) * 100);
  const color = distColor(distance);
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex justify-between text-[11px] mb-1 font-semibold text-neutral-400">
        <span>{label}</span>
        <span style={{ color }} className="font-bold tabular-nums">
          {(distance / 10).toFixed(1)} m
        </span>
      </div>
      <div className="h-1.5 w-full bg-[#181b22] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-75"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
};

const StatCard = ({
  label, value, sub, accent = 'text-white', icon,
}: {
  label: string; value: string | number; sub?: string;
  accent?: string; icon?: string;
}) => (
  <div className="bg-[#121418] border border-[#1c1f26] rounded-xl p-3.5">
    <div className="text-[11px] text-neutral-400 font-semibold mb-1 flex items-center gap-1">
      {icon && <span>{icon}</span>} {label}
    </div>
    <div className="flex items-baseline gap-1">
      <span className={`text-2xl font-bold font-mono ${accent}`}>{value}</span>
      {sub && <span className="text-xs font-semibold text-neutral-600">{sub}</span>}
    </div>
  </div>
);

// ─── Canvas renderer ─────────────────────────────────────────────────────────

function drawFrame(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  data: SimState | null,
) {
  const W = canvas.width;
  const H = canvas.height;

  // Background
  ctx.fillStyle = '#0f1115';
  ctx.fillRect(0, 0, W, H);

  // Subtle grid
  ctx.strokeStyle = '#181b22';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  if (!data) {
    ctx.fillStyle = '#475569';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Connecting to simulation… (ws://localhost:8000/ws/fsd)', W / 2, H / 2);
    return;
  }

  const { map, bestCar, otherAiCars, trafficCars } = data;

  // ── Road surface ──────────────────────────────────────────────────────────
  const cx   = map.size / 2;
  const rw   = map.roadWidth;
  const rMin = cx - rw / 2;
  const rMax = cx + rw / 2;

  ctx.fillStyle = '#1a1d24';
  // Horizontal road band
  ctx.fillRect(0, rMin, map.size, rw);
  // Vertical road band
  ctx.fillRect(rMin, 0, rw, map.size);

  // ── Stop zone ─────────────────────────────────────────────────────────────
  const sz = map.stopZone;
  const isInStop = bestCar.in_stop_zone;
  ctx.save();
  ctx.fillStyle = isInStop ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.06)';
  ctx.fillRect(sz.x, sz.y, sz.width, sz.height);
  ctx.strokeStyle = isInStop ? '#ef4444' : '#7f1d1d';
  ctx.lineWidth = isInStop ? 2 : 1;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(sz.x, sz.y, sz.width, sz.height);
  ctx.setLineDash([]);
  ctx.fillStyle = isInStop ? '#ef4444' : '#7f1d1d';
  ctx.font = `bold ${isInStop ? 11 : 9}px system-ui`;
  ctx.textAlign = 'center';
  ctx.fillText('STOP', sz.x + sz.width / 2, sz.y + sz.height / 2 + 4);
  ctx.restore();

  // ── Walls ─────────────────────────────────────────────────────────────────
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  map.walls.forEach(([p1, p2]) => {
    ctx.beginPath();
    ctx.moveTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.stroke();
  });

  // ── Checkpoints ───────────────────────────────────────────────────────────
  map.checkpoints.forEach(([p1, p2], i) => {
    const passed = i < bestCar.checkpoints;
    ctx.beginPath();
    ctx.moveTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.strokeStyle = passed ? '#22c55e55' : '#38bdf822';
    ctx.lineWidth = passed ? 2 : 1;
    ctx.stroke();
  });

  // ── Traffic NPCs ──────────────────────────────────────────────────────────
  trafficCars.forEach((npc) => {
    ctx.save();
    ctx.translate(npc.x, npc.y);
    ctx.rotate(npc.angle);
    const hw = npc.width  / 2;
    const hh = npc.height / 2;
    // NPC body (amber)
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(-hw, -hh, npc.width, npc.height);
    // Windshield
    ctx.fillStyle = '#0c0d10';
    ctx.fillRect(-hw + 4, -hh + 2, npc.width * 0.35, npc.height - 4);
    ctx.restore();
  });

  // ── Ghost AI cars ─────────────────────────────────────────────────────────
  otherAiCars.forEach((car) => {
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(-9, -4.5, 18, 9);
    ctx.restore();
  });

  // ── LIDAR rays (best car only) ────────────────────────────────────────────
  if (bestCar.impacts && bestCar.impacts.length > 0) {
    bestCar.impacts.forEach((imp) => {
      // Wall ray
      const wd = imp.wall.dist;
      ctx.beginPath();
      ctx.moveTo(bestCar.x, bestCar.y);
      ctx.lineTo(imp.wall.x, imp.wall.y);
      ctx.strokeStyle = distColor(wd) + '99';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Wall impact dot
      ctx.beginPath();
      ctx.arc(imp.wall.x, imp.wall.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = distColor(wd);
      ctx.shadowColor = distColor(wd);
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.shadowBlur = 0;

      // NPC ray (if hit something within sensor range)
      if (imp.npc.dist < 150) {
        ctx.beginPath();
        ctx.moveTo(bestCar.x, bestCar.y);
        ctx.lineTo(imp.npc.x, imp.npc.y);
        ctx.strokeStyle = '#f59e0b88';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.arc(imp.npc.x, imp.npc.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#f59e0b';
        ctx.shadowColor = '#f59e0b';
        ctx.shadowBlur = 5;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Stop zone ray
      if (imp.stop.dist < 150) {
        ctx.beginPath();
        ctx.moveTo(bestCar.x, bestCar.y);
        ctx.lineTo(imp.stop.x, imp.stop.y);
        ctx.strokeStyle = '#ef444455';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });
  }

  // ── Best car ──────────────────────────────────────────────────────────────
  ctx.save();
  ctx.translate(bestCar.x, bestCar.y);
  ctx.rotate(bestCar.angle);

  // Glow halo
  ctx.shadowColor = '#00e5ff';
  ctx.shadowBlur = 16;

  // Body (cyan/white)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-13, -6, 26, 12);

  // Rear lights
  ctx.fillStyle = bestCar.braking ? '#ef4444' : '#7f1d1d';
  ctx.fillRect(-13, -6, 5, 12);

  // Windshield
  ctx.fillStyle = '#0a1628';
  ctx.fillRect(2, -5, 7, 10);

  // Status stripe
  const stripeColors: Record<string, string> = {
    CRUISING: '#00e5ff', STOPPING: '#ef4444', STOP_DONE: '#22c55e',
  };
  ctx.fillStyle = stripeColors[bestCar.status] || '#00e5ff';
  ctx.fillRect(-13, -7.5, 26, 1.5);

  ctx.shadowBlur = 0;
  ctx.restore();

  // ── Legend dots (bottom-left) ─────────────────────────────────────────────
  const legendItems = [
    { color: '#ffffff', label: 'Best AI' },
    { color: 'rgba(255,255,255,0.18)', label: 'Ghost AI' },
    { color: '#f59e0b', label: 'NPC Traffic' },
  ];
  legendItems.forEach((item, i) => {
    const lx = 12;
    const ly = H - 14 - i * 18;
    ctx.fillStyle = item.color;
    ctx.beginPath();
    ctx.arc(lx + 4, ly, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(item.label, lx + 12, ly + 3.5);
  });
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function FSDSimulation() {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const dataRef    = useRef<SimState | null>(null);
  const frameRef   = useRef<number>();
  const wsRef      = useRef<WebSocket | null>(null);

  const [isConnected,  setIsConnected]  = useState(false);
  const [generation,   setGeneration]   = useState(1);
  const [alive,        setAlive]        = useState(0);
  const [checkpoints,  setCheckpoints]  = useState(0);
  const [bestFitness,  setBestFitness]  = useState(0);
  const [curFitness,   setCurFitness]   = useState(0);
  const [status,       setStatus]       = useState<string>('CRUISING');
  const [speedKmh,     setSpeedKmh]     = useState(0);
  const [steeringDeg,  setSteeringDeg]  = useState(0);
  const [lidar,        setLidar]        = useState<number[]>([150,150,150,150,150]);

  // ── WebSocket with auto-reconnect ─────────────────────────────────────────
  useEffect(() => {
    let isMounted = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const host  = window.location.hostname || '127.0.0.1';
      const wsUrl = `ws://${host}:8000/ws/fsd`;
      const ws    = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen  = () => { if (isMounted) setIsConnected(true); };
      ws.onmessage = (e) => {
        try { dataRef.current = JSON.parse(e.data); } catch {}
      };
      ws.onerror = () => {};
      ws.onclose = () => {
        if (isMounted) {
          setIsConnected(false);
          timer = setTimeout(connect, 1500);
        }
      };
    };

    connect();
    return () => {
      isMounted = false;
      if (timer) clearTimeout(timer);
      wsRef.current?.close();
    };
  }, []);

  // ── UI telemetry refresh (10 Hz) ──────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const d = dataRef.current;
      if (!d || !d.bestCar) return;

      const bc = d.bestCar;
      setGeneration(d.generation);
      setAlive(d.alive);
      setCheckpoints(bc.checkpoints);
      setCurFitness(bc.fitness);
      setBestFitness((prev) => Math.max(prev, bc.fitness));
      setStatus(bc.status);
      setSpeedKmh(Math.abs(bc.speed) * 12);
      setSteeringDeg((bc.steering * (180 / Math.PI)));

      // Build 5 wall distances from semantic LIDAR (indices 0,3,6,9,12)
      if (bc.lidar && bc.lidar.length === 15) {
        setLidar([bc.lidar[0], bc.lidar[3], bc.lidar[6], bc.lidar[9], bc.lidar[12]]);
      }
    }, 100);
    return () => clearInterval(interval);
  }, []);

  // ── Canvas render loop (rAF, 60 FPS) ─────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      drawFrame(ctx, canvas, dataRef.current);
      frameRef.current = requestAnimationFrame(render);
    };

    frameRef.current = requestAnimationFrame(render);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────
  const forceNextGen = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'force_next_gen' }));
    }
  }, []);

  const statusColors: Record<string, string> = {
    CRUISING:  'text-emerald-400',
    STOPPING:  'text-red-400',
    STOP_DONE: 'text-cyan-400',
  };
  const statusLabels: Record<string, string> = {
    CRUISING:  'En route',
    STOPPING:  'Freinage STOP',
    STOP_DONE: 'STOP respecté ✓',
  };

  return (
    <div className="flex h-screen bg-[#0f1115] text-white font-sans overflow-hidden select-none">

      {/* ── Canvas zone ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center relative bg-[#090a0d] p-4">
        <canvas
          ref={canvasRef}
          width={800}
          height={800}
          className="border border-[#1e222b] rounded-xl shadow-2xl bg-[#0f1115] max-h-full"
        />

        {/* Connection badge */}
        <div className="absolute top-6 left-6 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#12141a]/90 border border-[#1e222b] text-xs backdrop-blur-sm">
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
          <span className="text-neutral-400 font-medium">
            {isConnected ? 'Simulation Active · 60 FPS' : 'Connexion…'}
          </span>
        </div>

        {/* Generation badge */}
        <div className="absolute top-6 right-6 px-3 py-1.5 rounded-lg bg-[#12141a]/90 border border-[#1e222b] text-xs backdrop-blur-sm font-mono text-cyan-400 font-bold">
          GEN {generation}
        </div>
      </div>

      {/* ── Side dashboard ──────────────────────────────────────────────── */}
      <div className="w-[400px] bg-[#0c0d10] border-l border-[#1e2025] p-6 flex flex-col overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-7">
          <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
            <span className="text-blue-400">⚡</span> FSD Brain Analytics
          </h1>
          <span className="px-2.5 py-1 rounded-md bg-cyan-950/40 text-cyan-400 border border-cyan-800/40 text-[11px] font-bold">
            Leader #1
          </span>
        </div>

        {/* ── 1. LIDAR Perception ────────────────────────────────────────── */}
        <section className="mb-7">
          <h2 className="text-[10px] uppercase text-neutral-500 font-bold mb-3 tracking-widest">
            👁 Perception LIDAR · Murs
          </h2>
          <div className="bg-[#121418] border border-[#1c1f26] rounded-xl p-4">
            <LidarBar distance={lidar[0]} label="Gauche (−90°)" />
            <LidarBar distance={lidar[1]} label="Avant-Gauche (−45°)" />
            <LidarBar distance={lidar[2]} label="Centre (0°)" />
            <LidarBar distance={lidar[3]} label="Avant-Droit (+45°)" />
            <LidarBar distance={lidar[4]} label="Droit (+90°)" />
          </div>
        </section>

        {/* ── 2. Brain decisions ─────────────────────────────────────────── */}
        <section className="mb-7">
          <h2 className="text-[10px] uppercase text-neutral-500 font-bold mb-3 tracking-widest">
            🧭 Décisions du Cerveau
          </h2>
          <div className="bg-[#121418] border border-[#1c1f26] rounded-xl p-4 flex flex-col gap-3">
            <div className="flex justify-between items-center text-sm">
              <span className="text-neutral-400">Vitesse</span>
              <span className="text-blue-400 font-mono font-semibold tabular-nums">
                {speedKmh.toFixed(0)} km/h
              </span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-neutral-400">Braquage</span>
              <span className="text-white font-mono font-semibold tabular-nums">
                {steeringDeg.toFixed(1)}°
              </span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-neutral-400">Statut</span>
              <span className={`font-semibold ${statusColors[status] ?? 'text-white'}`}>
                {statusLabels[status] ?? status}
              </span>
            </div>
          </div>
        </section>

        {/* ── 3. Genetic stats ───────────────────────────────────────────── */}
        <section className="mb-7">
          <h2 className="text-[10px] uppercase text-neutral-500 font-bold mb-3 tracking-widest">
            📈 Statistiques NEAT
          </h2>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <StatCard label="Génération" value={generation} />
            <StatCard label="Voitures vivantes" value={alive} sub="/ 50" accent="text-cyan-400" icon="🏎" />
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <StatCard label="Checkpoints" value={checkpoints} sub="/ 8" accent="text-cyan-400" icon="⚑" />
            <StatCard label="Record absolu" value={bestFitness.toFixed(0)} sub="pts" accent="text-amber-400" icon="🏆" />
          </div>

          {/* Current fitness bar */}
          <div className="bg-[#121418] border border-[#1c1f26] rounded-xl p-3.5">
            <div className="flex justify-between items-center text-xs text-neutral-400 font-semibold mb-2">
              <span>Reward leader actuel</span>
              <span className="text-emerald-400 font-mono font-bold">+{curFitness.toFixed(1)} pts</span>
            </div>
            <div className="h-1.5 w-full bg-[#181b22] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${Math.min(100, (curFitness / Math.max(bestFitness, 1)) * 100)}%` }}
              />
            </div>
          </div>
        </section>

        {/* ── Actions ────────────────────────────────────────────────────── */}
        <div className="mt-auto flex flex-col gap-2.5">
          <button
            onClick={forceNextGen}
            disabled={!isConnected}
            className="w-full bg-[#0ea5e9] hover:bg-sky-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-sky-950/30 active:scale-[0.98]"
          >
            ⏭ Forcer la génération suivante
          </button>
          <button
            onClick={() => window.location.reload()}
            className="w-full bg-[#121418] border border-[#1e2025] hover:bg-[#1a1d24] text-neutral-300 font-semibold py-3 rounded-xl text-sm transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
          >
            ⟳ Réinitialiser la vue
          </button>
        </div>

        {/* Footer */}
        <p className="text-center text-[10px] text-neutral-700 mt-4">
          AutoPilot FSD · NEAT + Semantic LIDAR
        </p>
      </div>
    </div>
  );
}
