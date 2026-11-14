import type { GenerationMetric } from '../types/simulation';

interface FitnessChartProps {
  history: GenerationMetric[];
  allTimeBest: number;
}

/**
 * Graphique SVG léger traçant la fitness maximale et moyenne par génération NEAT.
 */
export function FitnessChart({ history, allTimeBest }: FitnessChartProps) {
  const width = 320;
  const height = 96;
  const padX = 6;
  const padY = 10;

  if (history.length === 0) {
    return (
      <div className="flex h-[108px] flex-col items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.015] px-4 text-center">
        <p className="text-[11px] font-medium text-zinc-400">
          Historique en attente de fin de génération 1
        </p>
        <p className="mt-0.5 text-[10px] text-zinc-600 tabular-nums">
          Record en cours : {allTimeBest.toFixed(1)} pts
        </p>
      </div>
    );
  }

  const values = history.flatMap((h) => [h.bestFitness, h.avgFitness]);
  const minVal = Math.min(0, ...values);
  const maxVal = Math.max(100, ...values);
  const range = Math.max(1, maxVal - minVal);

  const toX = (idx: number) =>
    history.length === 1
      ? width * 0.5
      : padX + (idx / (history.length - 1)) * (width - padX * 2);
  const toY = (val: number) =>
    height - padY - ((val - minVal) / range) * (height - padY * 2);

  const bestPoints = history.map((h, i) => `${toX(i).toFixed(1)},${toY(h.bestFitness).toFixed(1)}`);
  const avgPoints = history.map((h, i) => `${toX(i).toFixed(1)},${toY(h.avgFitness).toFixed(1)}`);

  const firstX = toX(0).toFixed(1);
  const lastX = toX(history.length - 1).toFixed(1);
  const baseY = (height - padY).toFixed(1);
  const areaPath = `M ${firstX},${baseY} L ${bestPoints.join(' L ')} L ${lastX},${baseY} Z`;

  const zeroY = toY(0);
  const latest = history[history.length - 1];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-zinc-300">
            <span className="h-1.5 w-3 rounded-full bg-cyan-400" />
            Max <span className="font-mono text-zinc-100 tabular-nums">{latest.bestFitness}</span>
          </span>
          <span className="flex items-center gap-1.5 text-zinc-500">
            <span className="h-1.5 w-3 rounded-full bg-zinc-500" />
            Moy <span className="font-mono text-zinc-400 tabular-nums">{latest.avgFitness}</span>
          </span>
        </div>
        <span className="font-mono text-[10px] text-zinc-500 tabular-nums">
          G1–G{latest.generation}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-24 w-full overflow-visible rounded-lg border border-white/[0.06] bg-white/[0.015]"
        role="img"
        aria-label="Courbe d'évolution de fitness par génération"
      >
        <defs>
          <linearGradient id="fitnessAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00e5ff" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#00e5ff" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {zeroY >= padY && zeroY <= height - padY && (
          <line
            x1={padX}
            y1={zeroY}
            x2={width - padX}
            y2={zeroY}
            stroke="rgba(255,255,255,0.08)"
            strokeDasharray="3 3"
          />
        )}

        {history.length > 1 ? (
          <>
            <path d={areaPath} fill="url(#fitnessAreaGrad)" />
            <polyline
              fill="none"
              stroke="rgba(161, 161, 170, 0.55)"
              strokeWidth="1.25"
              points={avgPoints.join(' ')}
            />
            <polyline
              fill="none"
              stroke="#00e5ff"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={bestPoints.join(' ')}
            />
          </>
        ) : (
          <circle cx={toX(0)} cy={toY(latest.bestFitness)} r="3.5" fill="#00e5ff" />
        )}
      </svg>
    </div>
  );
}
