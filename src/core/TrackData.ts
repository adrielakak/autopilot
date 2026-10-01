import * as THREE from 'three'

// 1. Smooth stadium circuit
const circuitPoints = [
  new THREE.Vector3(0, 0, 42),
  new THREE.Vector3(35, 0, 40),
  new THREE.Vector3(60, 0, 25),
  new THREE.Vector3(70, 0, 0),
  new THREE.Vector3(60, 0, -25),
  new THREE.Vector3(35, 0, -40),
  new THREE.Vector3(0, 0, -42),
  new THREE.Vector3(-35, 0, -40),
  new THREE.Vector3(-60, 0, -25),
  new THREE.Vector3(-70, 0, 0),
  new THREE.Vector3(-60, 0, 25),
  new THREE.Vector3(-35, 0, 40),
]

export const TRACK_CURVE = new THREE.CatmullRomCurve3(circuitPoints, true, 'catmullrom', 0.5)

// Road dimensions (width = 22)
export const ROAD_RADIUS = 11

// 2. Generate 36 discrete Checkpoints
export const NUM_CHECKPOINTS = 36

export interface Checkpoint {
  id: number
  position: THREE.Vector3
  tangent: THREE.Vector3
  angle: number
  normal: THREE.Vector3
}

export const CHECKPOINTS: Checkpoint[] = []

for (let i = 0; i < NUM_CHECKPOINTS; i++) {
  const t = i / NUM_CHECKPOINTS
  const pos = TRACK_CURVE.getPointAt(t)
  const tangent = TRACK_CURVE.getTangentAt(t).normalize()
  const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
  const angle = Math.atan2(-tangent.x, -tangent.z)

  CHECKPOINTS.push({
    id: i,
    position: pos,
    tangent,
    angle,
    normal
  })
}

// 3. Pre-compute 2D boundary segments for zero-overhead, 1000x faster raycasting
export interface TrackSegment2D {
  x1: number
  z1: number
  x2: number
  z2: number
}

export const TRACK_SEGMENTS: TrackSegment2D[] = []

for (let i = 0; i < NUM_CHECKPOINTS; i++) {
  const next = (i + 1) % NUM_CHECKPOINTS
  const cpA = CHECKPOINTS[i]
  const cpB = CHECKPOINTS[next]

  // Inner border
  const inA_x = cpA.position.x - cpA.normal.x * ROAD_RADIUS
  const inA_z = cpA.position.z - cpA.normal.z * ROAD_RADIUS
  const inB_x = cpB.position.x - cpB.normal.x * ROAD_RADIUS
  const inB_z = cpB.position.z - cpB.normal.z * ROAD_RADIUS
  TRACK_SEGMENTS.push({ x1: inA_x, z1: inA_z, x2: inB_x, z2: inB_z })

  // Outer border
  const outA_x = cpA.position.x + cpA.normal.x * ROAD_RADIUS
  const outA_z = cpA.position.z + cpA.normal.z * ROAD_RADIUS
  const outB_x = cpB.position.x + cpB.normal.x * ROAD_RADIUS
  const outB_z = cpB.position.z + cpB.normal.z * ROAD_RADIUS
  TRACK_SEGMENTS.push({ x1: outA_x, z1: outA_z, x2: outB_x, z2: outB_z })
}

// Ultra-fast analytical 2D raycaster (0 heap allocations, ~0.0005ms)
export function castRay2D(
  ox: number, oz: number,
  dx: number, dz: number,
  maxDist: number = 40
): number {
  let minDist = maxDist
  for (let i = 0; i < TRACK_SEGMENTS.length; i++) {
    const s = TRACK_SEGMENTS[i]
    const sx = s.x2 - s.x1
    const sz = s.z2 - s.z1
    const cross = dx * sz - dz * sx
    if (Math.abs(cross) < 1e-5) continue

    const qx = s.x1 - ox
    const qz = s.z1 - oz
    const t = (qx * sz - qz * sx) / cross
    const u = (qx * dz - qz * dx) / cross

    if (t > 0 && t < minDist && u >= 0 && u <= 1) {
      minDist = t
    }
  }
  return minDist
}

// Starting point
export const START_POSITION: [number, number] = [CHECKPOINTS[0].position.x, CHECKPOINTS[0].position.z]
export const START_ANGLE = CHECKPOINTS[0].angle
