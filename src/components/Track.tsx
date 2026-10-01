import { useMemo } from 'react'
import * as THREE from 'three'
import { TRACK_CURVE, ROAD_RADIUS, CHECKPOINTS } from '../core/TrackData'

export function Track() {
  const { roadGeometry, wallGeometry, centerLine, checkpointLines } = useMemo(() => {
    // 1. Road Geometry
    const roadGeometry = new THREE.TubeGeometry(TRACK_CURVE, 120, ROAD_RADIUS, 16, true)

    // 2. Center Line
    const centerLine = new THREE.TubeGeometry(TRACK_CURVE, 120, 0.25, 8, true)

    // 4. Visual Checkpoint Lines across the track
    const checkpointLines: { id: number; points: [number, number, number][] }[] = []
    
    CHECKPOINTS.forEach((cp) => {
      // Extends across the road width along the normal vector
      const halfW = ROAD_RADIUS * 0.95
      const p1 = cp.position.clone().addScaledVector(cp.normal, -halfW)
      const p2 = cp.position.clone().addScaledVector(cp.normal, halfW)
      
      checkpointLines.push({
        id: cp.id,
        points: [
          [p1.x, 0.05, p1.z],
          [p2.x, 0.05, p2.z]
        ]
      })
    })

    return { roadGeometry, centerLine, checkpointLines }
  }, [])

  return (
    <group>
      {/* Dark Minimal Ground */}
      <mesh position={[0, -0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[3000, 3000]} />
        <meshStandardMaterial color="#08080a" roughness={1} />
      </mesh>
      
      {/* Asphalt Road Surface (flattened tube) */}
      <mesh geometry={roadGeometry} position={[0, 0, 0]} scale={[1, 0.001, 1]} receiveShadow>
        <meshStandardMaterial color="#18181b" roughness={0.7} metalness={0.1} />
      </mesh>

      {/* Road Borders (curbs) */}
      <mesh geometry={roadGeometry} position={[0, 0.01, 0]} scale={[1.01, 0.002, 1.01]}>
        <meshStandardMaterial color="#27272a" roughness={0.9} />
      </mesh>

      {/* Decorative Center Line */}
      <mesh geometry={centerLine} position={[0, 0.08, 0]} scale={[1, 0.01, 1]}>
        <meshStandardMaterial color="#ffffff" roughness={0.4} emissive="#ffffff" emissiveIntensity={0.6} />
      </mesh>

      {/* Checkpoints Visual Gates / Laser Lines */}
      {checkpointLines.map((cp) => {
        const isStart = cp.id === 0
        const color = isStart ? '#00e5ff' : '#00aaff'
        const opacity = isStart ? 0.9 : 0.25
        
        return (
          <group key={cp.id}>
            <line>
              <bufferGeometry attach="geometry">
                <bufferAttribute
                  attach="attributes-position"
                  count={2}
                  array={new Float32Array([...cp.points[0], ...cp.points[1]])}
                  itemSize={3}
                />
              </bufferGeometry>
              <lineBasicMaterial attach="material" color={color} transparent opacity={opacity} linewidth={isStart ? 3 : 1} />
            </line>
          </group>
        )
      })}

    </group>
  )
}
