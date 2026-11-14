import { Component, useMemo, useRef } from 'react';
import type { ComponentRef, ErrorInfo, ReactNode, RefObject } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Line, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import type { MapData, SimState } from '../types/simulation';

const SCALE = 0.05;
const MAX_GHOSTS = 50;
const MAX_NPCS = 4;
const LIDAR_RAY_COUNT = 5;

function toWorldX(x: number, mapSize: number): number {
  return (x - mapSize * 0.5) * SCALE;
}

function toWorldZ(y: number, mapSize: number): number {
  return (y - mapSize * 0.5) * SCALE;
}

interface Scene3DViewProps {
  stateRef: RefObject<SimState | null>;
  mapData: MapData | null;
  activeCheckpointIndex: number;
  showLidar: boolean;
  showGhosts: boolean;
  followCamera: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class WebGLErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[FSD 3D] Rendu WebGL indisponible:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[#09090b] p-6 text-center">
          <p className="text-sm font-medium text-zinc-200">
            Contexte WebGL 3D indisponible sur cet appareil
          </p>
          <p className="text-xs text-zinc-500">
            Basculez sur la vue 2D Télémétrie dans la barre supérieure pour visualiser la simulation.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

interface Track3DProps {
  mapData: MapData;
  activeCheckpointIndex: number;
}

function Track3D({ mapData, activeCheckpointIndex }: Track3DProps) {
  const { roadGeometry, wallSpecs, centerlinePoints } = useMemo(() => {
    const outer = mapData.outerBounds;
    const inner = mapData.innerBounds;
    const shape = new THREE.Shape();

    if (outer.length > 2) {
      outer.forEach(([x, y], i) => {
        const sx = toWorldX(x, mapData.size);
        const sy = -toWorldZ(y, mapData.size);
        if (i === 0) shape.moveTo(sx, sy);
        else shape.lineTo(sx, sy);
      });
      shape.closePath();

      if (inner.length > 2) {
        const hole = new THREE.Path();
        inner.forEach(([x, y], i) => {
          const sx = toWorldX(x, mapData.size);
          const sy = -toWorldZ(y, mapData.size);
          if (i === 0) hole.moveTo(sx, sy);
          else hole.lineTo(sx, sy);
        });
        hole.closePath();
        shape.holes.push(hole);
      }
    }

    const geometry = new THREE.ShapeGeometry(shape);

    const walls = mapData.walls.map(([[x1, y1], [x2, y2]], idx) => {
      const wx1 = toWorldX(x1, mapData.size);
      const wz1 = toWorldZ(y1, mapData.size);
      const wx2 = toWorldX(x2, mapData.size);
      const wz2 = toWorldZ(y2, mapData.size);
      const dx = wx2 - wx1;
      const dz = wz2 - wz1;
      return {
        key: idx,
        x: (wx1 + wx2) * 0.5,
        z: (wz1 + wz2) * 0.5,
        length: Math.hypot(dx, dz),
        rotY: -Math.atan2(dz, dx),
      };
    });

    const centerPts: [number, number, number][] = mapData.centerline.map(([x, y]) => [
      toWorldX(x, mapData.size),
      0.03,
      toWorldZ(y, mapData.size),
    ]);
    if (centerPts.length > 0) {
      centerPts.push(centerPts[0]);
    }

    return { roadGeometry: geometry, wallSpecs: walls, centerlinePoints: centerPts };
  }, [mapData]);

  const sz = mapData.stopZone;
  const stopW = sz.width * SCALE;
  const stopH = sz.height * SCALE;
  const stopCx = toWorldX(sz.x + sz.width * 0.5, mapData.size);
  const stopCz = toWorldZ(sz.y + sz.height * 0.5, mapData.size);

  const activeCp = mapData.checkpoints[activeCheckpointIndex];

  return (
    <group>
      {/* Chaussée octogonale */}
      <mesh geometry={roadGeometry} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <meshStandardMaterial color="#161923" roughness={0.88} metalness={0.08} />
      </mesh>

      {/* Ligne médiane */}
      {centerlinePoints.length > 1 && (
        <Line
          points={centerlinePoints}
          color="#3f4454"
          lineWidth={1.2}
          dashed
          dashSize={0.5}
          gapSize={0.4}
        />
      )}

      {/* Murs / glissières */}
      {wallSpecs.map((w) => (
        <mesh
          key={w.key}
          position={[w.x, 0.28, w.z]}
          rotation={[0, w.rotY, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[w.length, 0.56, 0.14]} />
          <meshStandardMaterial color="#3b4252" roughness={0.55} metalness={0.35} />
        </mesh>
      ))}

      {/* Zone STOP */}
      <mesh position={[stopCx, 0.02, stopCz]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[stopW, stopH]} />
        <meshBasicMaterial color="#ef4444" transparent opacity={0.18} />
      </mesh>
      <mesh
        position={[stopCx + stopW * 0.5 - 0.08, 0.025, stopCz]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[0.16, stopH * 0.92]} />
        <meshBasicMaterial color="#f87171" />
      </mesh>

      {/* Checkpoint actif suivant */}
      {activeCp && (
        <Line
          points={[
            [toWorldX(activeCp[0][0], mapData.size), 0.05, toWorldZ(activeCp[0][1], mapData.size)],
            [toWorldX(activeCp[1][0], mapData.size), 0.05, toWorldZ(activeCp[1][1], mapData.size)],
          ]}
          color="#00e5ff"
          lineWidth={2}
          dashed
          dashSize={0.35}
          gapSize={0.25}
        />
      )}
    </group>
  );
}

interface DynamicFleetProps {
  stateRef: RefObject<SimState | null>;
  mapSize: number;
  showLidar: boolean;
  showGhosts: boolean;
  followCamera: boolean;
  controlsRef: RefObject<ComponentRef<typeof OrbitControls> | null>;
}

function DynamicFleet({
  stateRef,
  mapSize,
  showLidar,
  showGhosts,
  followCamera,
  controlsRef,
}: DynamicFleetProps) {
  const bestCarRef = useRef<THREE.Group>(null);
  const wheelFlRef = useRef<THREE.Mesh>(null);
  const wheelFrRef = useRef<THREE.Mesh>(null);
  const brakeMatRef = useRef<THREE.MeshStandardMaterial>(null);

  const npcRefs = useRef<(THREE.Group | null)[]>([]);
  const ghostRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lidarRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lidarMatRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([]);

  useFrame(() => {
    const state = stateRef.current;
    if (!state) return;

    // 1. Véhicules trafic NPC
    for (let i = 0; i < MAX_NPCS; i += 1) {
      const group = npcRefs.current[i];
      if (!group) continue;
      const npc = state.trafficCars[i];
      if (!npc) {
        group.visible = false;
        continue;
      }
      group.visible = true;
      group.position.set(toWorldX(npc.x, mapSize), 0.34, toWorldZ(npc.y, mapSize));
      group.rotation.y = -npc.angle;
      group.scale.set(npc.width * SCALE, 1, npc.height * SCALE);
    }

    // 2. Essaim fantôme NEAT
    for (let i = 0; i < MAX_GHOSTS; i += 1) {
      const mesh = ghostRefs.current[i];
      if (!mesh) continue;
      const ghost = showGhosts ? state.otherAiCars[i] : undefined;
      if (!ghost) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set(toWorldX(ghost.x, mapSize), 0.2, toWorldZ(ghost.y, mapSize));
      mesh.rotation.y = -(ghost.angle ?? 0);
    }

    // 3. Véhicule leader + faisceaux LIDAR
    const bc = state.bestCar;
    const carGroup = bestCarRef.current;
    if (carGroup && bc) {
      const wx = toWorldX(bc.x, mapSize);
      const wz = toWorldZ(bc.y, mapSize);
      carGroup.visible = true;
      carGroup.position.set(wx, 0.25, wz);
      carGroup.rotation.y = -bc.angle;

      const steerRot = -bc.steering * 0.45;
      if (wheelFlRef.current) wheelFlRef.current.rotation.y = steerRot;
      if (wheelFrRef.current) wheelFrRef.current.rotation.y = steerRot;
      if (brakeMatRef.current) {
        brakeMatRef.current.emissiveIntensity = bc.braking ? 3.2 : 0.4;
      }

      // Caméra suiveuse fluide si activée
      if (followCamera && controlsRef.current) {
        controlsRef.current.target.lerp(new THREE.Vector3(wx, 0.4, wz), 0.12);
        controlsRef.current.update();
      }

      // Rayons LIDAR 3D sémantiques
      for (let i = 0; i < LIDAR_RAY_COUNT; i += 1) {
        const rayMesh = lidarRefs.current[i];
        const rayMat = lidarMatRefs.current[i];
        const impact = bc.impacts?.[i];
        if (!rayMesh || !rayMat) continue;

        if (!showLidar || !impact) {
          rayMesh.visible = false;
          continue;
        }

        let target = impact.wall;
        let hex = 0x00e5ff;
        if (impact.stop.dist < impact.wall.dist && impact.stop.dist <= impact.npc.dist) {
          target = impact.stop;
          hex = 0x34d399;
        } else if (impact.npc.dist < impact.wall.dist) {
          target = impact.npc;
          hex = 0xf59e0b;
        } else if (impact.wall.dist < 42) {
          hex = 0xf87171;
        }

        const tx = toWorldX(target.x, mapSize);
        const tz = toWorldZ(target.y, mapSize);
        const dx = tx - wx;
        const dz = tz - wz;
        const len = Math.max(0.05, Math.hypot(dx, dz));

        rayMesh.visible = true;
        rayMesh.position.set((wx + tx) * 0.5, 0.3, (wz + tz) * 0.5);
        rayMesh.rotation.y = -Math.atan2(dz, dx);
        rayMesh.scale.set(len, 1, 1);
        rayMat.color.setHex(hex);
      }
    } else if (carGroup) {
      carGroup.visible = false;
    }
  });

  return (
    <group>
      {/* Voiture Leader FSD */}
      <group ref={bestCarRef} visible={false}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[1.5, 0.36, 0.82]} />
          <meshStandardMaterial color="#0b1320" metalness={0.6} roughness={0.28} />
        </mesh>
        <mesh position={[-0.08, 0.25, 0]} castShadow>
          <boxGeometry args={[0.78, 0.24, 0.64]} />
          <meshStandardMaterial color="#00e5ff" transparent opacity={0.42} roughness={0.15} />
        </mesh>
        <mesh position={[-0.76, 0.02, 0]}>
          <boxGeometry args={[0.04, 0.14, 0.68]} />
          <meshStandardMaterial
            ref={brakeMatRef}
            color="#ef4444"
            emissive="#ef4444"
            emissiveIntensity={0.4}
          />
        </mesh>
        <mesh ref={wheelFlRef} position={[0.45, -0.1, -0.44]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.16, 0.16, 0.12, 12]} />
          <meshStandardMaterial color="#18181b" />
        </mesh>
        <mesh ref={wheelFrRef} position={[0.45, -0.1, 0.44]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.16, 0.16, 0.12, 12]} />
          <meshStandardMaterial color="#18181b" />
        </mesh>
      </group>

      {/* Rayons LIDAR 3D */}
      {Array.from({ length: LIDAR_RAY_COUNT }, (_, idx) => (
        <mesh
          key={`lidar-${idx}`}
          ref={(el) => {
            lidarRefs.current[idx] = el;
          }}
          visible={false}
        >
          <boxGeometry args={[1, 0.04, 0.04]} />
          <meshBasicMaterial
            ref={(el) => {
              lidarMatRefs.current[idx] = el;
            }}
            color="#00e5ff"
            transparent
            opacity={0.78}
          />
        </mesh>
      ))}

      {/* Trafic NPC */}
      {Array.from({ length: MAX_NPCS }, (_, idx) => (
        <group
          key={`npc-${idx}`}
          ref={(el) => {
            npcRefs.current[idx] = el;
          }}
          visible={false}
        >
          <mesh castShadow receiveShadow>
            <boxGeometry args={[1, 0.46, 1]} />
            <meshStandardMaterial color="#d97706" metalness={0.35} roughness={0.4} />
          </mesh>
        </group>
      ))}

      {/* Essaim Fantôme */}
      {Array.from({ length: MAX_GHOSTS }, (_, idx) => (
        <mesh
          key={`ghost-${idx}`}
          ref={(el) => {
            ghostRefs.current[idx] = el;
          }}
          visible={false}
        >
          <boxGeometry args={[1.1, 0.24, 0.6]} />
          <meshStandardMaterial color="#00e5ff" transparent opacity={0.22} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Vue 3D WebGL temps réel synchronisée avec la simulation NEAT du backend.
 */
export function Scene3DView({
  stateRef,
  mapData,
  activeCheckpointIndex,
  showLidar,
  showGhosts,
  followCamera,
}: Scene3DViewProps) {
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);
  const activeCpIndex =
    mapData && mapData.checkpoints.length > 0
      ? activeCheckpointIndex % mapData.checkpoints.length
      : 0;

  return (
    <WebGLErrorBoundary>
      <div className="relative h-full w-full select-none bg-[#07080c]">
        <Canvas shadows dpr={[1, 2]}>
          <color attach="background" args={['#07080c']} />
          <fog attach="fog" args={['#07080c', 28, 70]} />
          <PerspectiveCamera makeDefault position={[0, 29, 25]} fov={46} />
          <OrbitControls
            ref={controlsRef}
            enableDamping
            dampingFactor={0.08}
            maxPolarAngle={Math.PI * 0.46}
            minDistance={8}
            maxDistance={52}
          />
          <ambientLight intensity={0.75} />
          <directionalLight position={[14, 26, 12]} intensity={1.3} castShadow />

          <gridHelper args={[48, 32, '#1e222d', '#11141c']} position={[0, -0.01, 0]} />

          {mapData && (
            <>
              <Track3D mapData={mapData} activeCheckpointIndex={activeCpIndex} />
              <DynamicFleet
                stateRef={stateRef}
                mapSize={mapData.size}
                showLidar={showLidar}
                showGhosts={showGhosts}
                followCamera={followCamera}
                controlsRef={controlsRef}
              />
            </>
          )}
        </Canvas>
      </div>
    </WebGLErrorBoundary>
  );
}
