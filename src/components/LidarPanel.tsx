const RAY_LABELS = ['-90°', '-45°', '0°', '+45°', '+90°'];
const MAX_RANGE = 150;

interface LidarPanelProps {
  lidar: number[];
}

/**
 * Tableau compact affichant les 15 canaux sémantiques (5 angles × Mur / NPC / STOP).
 */
export function LidarPanel({ lidar }: LidarPanelProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[10px] text-zinc-500">
        <span>Angle</span>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
            Mur
          </span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            NPC
          </span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            STOP
          </span>
        </div>
      </div>

      <div className="space-y-1.5">
        {RAY_LABELS.map((label, idx) => {
          const base = idx * 3;
          const dWall = lidar[base] ?? MAX_RANGE;
          const dNpc = lidar[base + 1] ?? MAX_RANGE;
          const dStop = lidar[base + 2] ?? MAX_RANGE;

          const wallPct = Math.max(4, Math.min(100, (dWall / MAX_RANGE) * 100));
          const npcPct = Math.max(0, Math.min(100, 100 - (dNpc / MAX_RANGE) * 100));
          const stopPct = Math.max(0, Math.min(100, 100 - (dStop / MAX_RANGE) * 100));
          const wallDanger = dWall < 32;

          return (
            <div
              key={label}
              className="grid grid-cols-[36px_1fr_44px] items-center gap-2 rounded-md border border-white/[0.05] bg-white/[0.015] px-2.5 py-1.5"
            >
              <span className="font-mono text-[10px] text-zinc-400 tabular-nums">{label}</span>

              <div className="space-y-1">
                <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className={`h-full rounded-full transition-[width] duration-150 ${
                      wallDanger ? 'bg-rose-400' : 'bg-cyan-400/80'
                    }`}
                    style={{ width: `${wallPct}%` }}
                  />
                </div>
                <div className="flex gap-1">
                  <div className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                    <div
                      className="h-full bg-amber-400 transition-[width] duration-150"
                      style={{ width: `${npcPct}%` }}
                    />
                  </div>
                  <div className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                    <div
                      className="h-full bg-emerald-400 transition-[width] duration-150"
                      style={{ width: `${stopPct}%` }}
                    />
                  </div>
                </div>
              </div>

              <span className="text-right font-mono text-[10px] text-zinc-300 tabular-nums">
                {Math.round(Math.min(dWall, dNpc))}m
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
