import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { MapData, SimState } from '../types/simulation';

interface Canvas2DViewProps {
  stateRef: RefObject<SimState | null>;
  mapRef: RefObject<MapData | null>;
  showLidar: boolean;
  showGhosts: boolean;
  followCamera: boolean;
}

/**
 * Rendu 2D haute précision (HiDPI / Retina) du circuit octogonal,
 * de la flotte NEAT, du trafic transversal et du LIDAR sémantique 3 voies.
 */
export function Canvas2DView({
  stateRef,
  mapRef,
  showLidar,
  showGhosts,
  followCamera,
}: Canvas2DViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const optionsRef = useRef({ showLidar, showGhosts, followCamera });

  useEffect(() => {
    optionsRef.current = { showLidar, showGhosts, followCamera };
  }, [showLidar, showGhosts, followCamera]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let cssWidth = container.clientWidth || 800;
    let cssHeight = container.clientHeight || 800;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    const syncSize = () => {
      cssWidth = Math.max(200, container.clientWidth);
      cssHeight = Math.max(200, container.clientHeight);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
    };

    syncSize();
    const observer = new ResizeObserver(syncSize);
    observer.observe(container);

    const cam = { x: 400, y: 400, zoom: 1 };
    let rafId = 0;

    const drawLoop = () => {
      const state = stateRef.current;
      const map = state?.map ?? mapRef.current;
      const { showLidar: lidarOn, showGhosts: ghostsOn, followCamera: follow } = optionsRef.current;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssWidth, cssHeight);

      if (!state || !map) {
        rafId = window.requestAnimationFrame(drawLoop);
        return;
      }

      const padding = 28;
      const baseScale = Math.min((cssWidth - padding * 2) / map.size, (cssHeight - padding * 2) / map.size);

      const targetX = follow && state.bestCar ? state.bestCar.x : map.size * 0.5;
      const targetY = follow && state.bestCar ? state.bestCar.y : map.size * 0.5;
      const targetZoom = follow ? 1.65 : 1.0;

      cam.x += (targetX - cam.x) * 0.14;
      cam.y += (targetY - cam.y) * 0.14;
      cam.zoom += (targetZoom - cam.zoom) * 0.12;

      const scale = baseScale * cam.zoom;
      ctx.save();
      ctx.translate(cssWidth * 0.5, cssHeight * 0.5);
      ctx.scale(scale, scale);
      ctx.translate(-cam.x, -cam.y);

      // 1. Chaussée octogonale réelle (couronne extérieure moins îlot central via evenodd)
      if (map.outerBounds.length > 2 && map.innerBounds.length > 2) {
        ctx.save();
        ctx.beginPath();
        map.outerBounds.forEach(([px, py], i) => {
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();

        // Îlot intérieur (tracé dans le même path pour découpe evenodd)
        map.innerBounds.forEach(([px, py], i) => {
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();

        ctx.fillStyle = '#141720';
        ctx.fill('evenodd');

        // Texture de l'îlot central
        ctx.beginPath();
        map.innerBounds.forEach(([px, py], i) => {
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.fillStyle = '#0c0d12';
        ctx.fill();
        ctx.restore();
      }

      // 2. Ligne médiane pointillée du circuit
      if (map.centerline.length > 2) {
        ctx.save();
        ctx.beginPath();
        map.centerline.forEach(([px, py], i) => {
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
        ctx.lineWidth = 2;
        ctx.setLineDash([12, 12]);
        ctx.stroke();
        ctx.restore();
      }

      // 3. Checkpoints séquentiels (prochain checkpoint mis en évidence)
      const totalCp = map.checkpoints.length || 1;
      const passedCount = state.bestCar?.checkpoints ?? 0;
      const activeIdx = passedCount % totalCp;

      map.checkpoints.forEach(([[x1, y1], [x2, y2]], idx) => {
        const isNext = idx === activeIdx;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = isNext
          ? 'rgba(0, 229, 255, 0.55)'
          : 'rgba(148, 163, 184, 0.12)';
        ctx.lineWidth = isNext ? 2.5 : 1;
        ctx.setLineDash(isNext ? [6, 4] : [3, 6]);
        ctx.stroke();
        ctx.restore();
      });

      // 4. Zone STOP et bande d'arrêt réglementaire
      const sz = map.stopZone;
      const stopDone = Boolean(state.bestCar?.stop_rule_fulfilled);
      ctx.save();
      ctx.fillStyle = stopDone ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)';
      ctx.strokeStyle = stopDone ? 'rgba(16, 185, 129, 0.45)' : 'rgba(239, 68, 68, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.fillRect(sz.x, sz.y, sz.width, sz.height);
      ctx.strokeRect(sz.x, sz.y, sz.width, sz.height);

      // Ligne blanche d'arrêt à la sortie (x + width)
      ctx.beginPath();
      ctx.moveTo(sz.x + sz.width, sz.y + 4);
      ctx.lineTo(sz.x + sz.width, sz.y + sz.height - 4);
      ctx.strokeStyle = stopDone ? '#34d399' : '#f87171';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.fillStyle = stopDone ? 'rgba(52, 211, 153, 0.85)' : 'rgba(248, 113, 113, 0.85)';
      ctx.font = '600 12px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('STOP', sz.x + sz.width * 0.5, sz.y + sz.height * 0.5);
      ctx.restore();

      // 5. Glissières et murs structurels
      ctx.save();
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const [[x1, y1], [x2, y2]] of map.walls) {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      ctx.restore();

      // 6. Essaim fantôme (autres agents NEAT vivants)
      if (ghostsOn && state.otherAiCars.length > 0) {
        ctx.save();
        for (const ghost of state.otherAiCars) {
          ctx.save();
          ctx.translate(ghost.x, ghost.y);
          ctx.rotate(ghost.angle ?? 0);
          ctx.fillStyle = 'rgba(0, 229, 255, 0.16)';
          ctx.strokeStyle = 'rgba(0, 229, 255, 0.36)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(-11, -6, 22, 12, 3);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
        ctx.restore();
      }

      // 7. Véhicules de trafic NPC
      for (const npc of state.trafficCars) {
        ctx.save();
        ctx.translate(npc.x, npc.y);
        ctx.rotate(npc.angle);

        ctx.fillStyle = '#27272a';
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.roundRect(-npc.width * 0.5, -npc.height * 0.5, npc.width, npc.height, 4);
        ctx.fill();
        ctx.stroke();

        // Pare-brise et phares avant
        ctx.fillStyle = 'rgba(245, 158, 11, 0.4)';
        ctx.fillRect(npc.width * 0.18, -npc.height * 0.34, npc.width * 0.16, npc.height * 0.68);
        ctx.fillStyle = '#fde68a';
        ctx.fillRect(npc.width * 0.44, -npc.height * 0.36, 3, 3.5);
        ctx.fillRect(npc.width * 0.44, npc.height * 0.18, 3, 3.5);
        ctx.restore();
      }

      // 8. Faisceaux LIDAR sémantiques et voiture leader
      const bc = state.bestCar;
      if (bc) {
        if (lidarOn && Array.isArray(bc.impacts)) {
          for (const ray of bc.impacts) {
            const { wall, npc, stop } = ray;
            // Priorité d'affichage sur l'obstacle le plus proche
            let target = wall;
            let stroke = 'rgba(0, 229, 255, 0.35)';
            let dotColor = '#00e5ff';

            if (stop.dist < wall.dist && stop.dist <= npc.dist) {
              target = stop;
              stroke = 'rgba(52, 211, 153, 0.65)';
              dotColor = '#34d399';
            } else if (npc.dist < wall.dist) {
              target = npc;
              stroke = 'rgba(245, 158, 11, 0.78)';
              dotColor = '#fbbf24';
            } else if (wall.dist < 42) {
              stroke = 'rgba(248, 113, 113, 0.78)';
              dotColor = '#f87171';
            }

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(bc.x, bc.y);
            ctx.lineTo(target.x, target.y);
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 1.4;
            ctx.stroke();

            if (target.dist < 149) {
              ctx.beginPath();
              ctx.arc(target.x, target.y, 3.2, 0, Math.PI * 2);
              ctx.fillStyle = dotColor;
              ctx.fill();
            }
            ctx.restore();
          }
        }

        // Châssis du véhicule leader
        ctx.save();
        ctx.translate(bc.x, bc.y);
        ctx.rotate(bc.angle);

        // Roues avant directrices
        const steerRad = bc.steering * 0.45;
        ctx.fillStyle = '#52525b';
        for (const wy of [-9, 9]) {
          ctx.save();
          ctx.translate(8, wy);
          ctx.rotate(steerRad);
          ctx.fillRect(-3.5, -1.6, 7, 3.2);
          ctx.restore();
        }

        // Halo léger si freinage actif
        if (bc.braking) {
          ctx.fillStyle = 'rgba(239, 68, 68, 0.28)';
          ctx.beginPath();
          ctx.ellipse(-15, 0, 7, 9, 0, 0, Math.PI * 2);
          ctx.fill();
        }

        // Carrosserie
        ctx.fillStyle = '#09090b';
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(-15, -8, 30, 16, 4);
        ctx.fill();
        ctx.stroke();

        // Verrière cockpit
        ctx.fillStyle = 'rgba(0, 229, 255, 0.28)';
        ctx.beginPath();
        ctx.roundRect(-3, -5.5, 11, 11, 2);
        ctx.fill();

        // Phares avant & feux stop arrière
        ctx.fillStyle = '#e0f2fe';
        ctx.fillRect(13.5, -6, 2, 3.5);
        ctx.fillRect(13.5, 2.5, 2, 3.5);

        ctx.fillStyle = bc.braking ? '#ff2a3c' : '#7f1d1d';
        ctx.fillRect(-15.5, -6, 2, 3.8);
        ctx.fillRect(-15.5, 2.2, 2, 3.8);

        ctx.restore();
      }

      ctx.restore();
      rafId = window.requestAnimationFrame(drawLoop);
    };

    rafId = window.requestAnimationFrame(drawLoop);
    return () => {
      window.cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [stateRef, mapRef]);

  return (
    <div ref={containerRef} className="relative h-full w-full select-none">
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
