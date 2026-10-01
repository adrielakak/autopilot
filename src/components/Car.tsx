import { useRef, useMemo, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { CarPhysics } from '../core/CarPhysics'
import { NeuralNetwork } from '../core/NeuralNetwork'
import { CHECKPOINTS, START_POSITION, START_ANGLE, NUM_CHECKPOINTS, castRay2D } from '../core/TrackData'

export interface CarTelemetry {
  id: number
  fitness: number
  checkpoints: number
  damaged: boolean
  readings: number[]
  steering: number
  speed: number
  isBraking: boolean
}

// -------------------------------------------------------------
// SHARED GEOMETRIES & MATERIALS (Created ONCE to save GPU memory)
// -------------------------------------------------------------
const sharedBodyGeo = new THREE.BoxGeometry(2, 1, 4)
const sharedCabinGeo = new THREE.BoxGeometry(1.8, 0.7, 2)
const sharedWheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 16)
sharedWheelGeo.rotateZ(Math.PI / 2) // Pre-rotated so no nested rotations needed
const sharedTailLightGeo = new THREE.BoxGeometry(0.6, 0.2, 0.1)

const sharedCabinMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.9 })
const sharedWheelMat = new THREE.MeshStandardMaterial({ color: 0x27272a, roughness: 0.8 })
const sharedGhostMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.5, transparent: true, opacity: 0.2 })
const sharedLeaderMat = new THREE.MeshStandardMaterial({ color: 0x00e5ff, roughness: 0.2, metalness: 0.8 })
const sharedBrakeMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff0000, emissiveIntensity: 0.8 })
const sharedIdleTailMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0x660000, emissiveIntensity: 0.2 })

// 5 sensor ray angles relative to car heading
const RAY_ANGLES = [-Math.PI / 2, -Math.PI / 4, 0, Math.PI / 4, Math.PI / 2]
const MAX_RAY_DISTANCE = 40

export function Car({ 
  id = 0,
  generation = 1,
  startPos = START_POSITION, 
  startAngle = START_ANGLE,
  brain,
  isBest = false,
  onTelemetry
}: { 
  id?: number
  generation?: number
  startPos?: [number, number] 
  startAngle?: number
  brain?: NeuralNetwork
  isBest?: boolean
  onTelemetry?: (telemetry: CarTelemetry) => void
}) {
  const groupRef = useRef<THREE.Group>(null)
  
  // Physics instance
  const physics = useMemo(() => new CarPhysics(startPos[0], startPos[1], startAngle), [startPos, startAngle])
  
  const damaged = useRef(false)
  const fitness = useRef(0)
  const checkpointsPassed = useRef(0)
  const nextCheckpoint = useRef(1)
  const timeSinceLastCheckpoint = useRef(0)
  const timeAlive = useRef(0)
  const lastDispatchTime = useRef(0)

  // Wheel meshes for visual steering
  const frontLeftWheel = useRef<THREE.Mesh>(null)
  const frontRightWheel = useRef<THREE.Mesh>(null)

  // Ray visual lines (ONLY for isBest)
  const rayLines = useRef<THREE.Line[]>([])

  // Reset physics smoothly on new generation without re-creating 3D nodes
  useEffect(() => {
    physics.reset(startPos[0], startPos[1], startAngle)
    damaged.current = false
    fitness.current = 0
    checkpointsPassed.current = 0
    nextCheckpoint.current = 1
    timeSinceLastCheckpoint.current = 0
    timeAlive.current = 0
  }, [generation, physics, startPos, startAngle])

  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 0.1)

    // Stopped if damaged
    if (damaged.current) {
      physics.speed = 0
      physics.controls.forward = false
      physics.controls.reverse = false
      physics.controls.left = false
      physics.controls.right = false
    } else {
      timeAlive.current += dt
      timeSinceLastCheckpoint.current += dt

      // 1. Checkpoint Progression
      const targetCp = CHECKPOINTS[nextCheckpoint.current].position
      const distToTarget = Math.hypot(physics.x - targetCp.x, physics.y - targetCp.z)

      // Reached checkpoint! (within 9 units)
      if (distToTarget < 9.0) {
        checkpointsPassed.current += 1
        nextCheckpoint.current = (nextCheckpoint.current + 1) % NUM_CHECKPOINTS
        timeSinceLastCheckpoint.current = 0
      }

      // Reward formula: Checkpoints + proximity progress
      const proximityBonus = Math.max(0, (1 - distToTarget / 30) * 50)
      fitness.current = checkpointsPassed.current * 100 + proximityBonus

      // Timeout penalty: eliminate if stuck > 3.5s
      if (timeSinceLastCheckpoint.current > 3.5) {
        damaged.current = true
      }

      // Eliminate if stopped after 1.2s
      if (timeAlive.current > 1.2 && physics.speed < 0.05) {
        damaged.current = true
      }

      // 2. Ultra-Fast Analytical 2D Raycasting (0 Heap Allocation)
      const readings: number[] = [40, 40, 40, 40, 40]
      const inputs: number[] = [0, 0, 0, 0, 0]

      for (let i = 0; i < 5; i++) {
        const globalAngle = physics.angle + RAY_ANGLES[i]
        const dirX = -Math.sin(globalAngle)
        const dirZ = -Math.cos(globalAngle)

        const dist = castRay2D(physics.x, physics.y, dirX, dirZ, MAX_RAY_DISTANCE)
        readings[i] = dist
        inputs[i] = 1 - (dist / MAX_RAY_DISTANCE)

        // Wall collision: car half-width is 1, half-length is 2
        if (dist < 1.6) {
          damaged.current = true
        }

        // Update visual lines only for the leader
        if (isBest && rayLines.current[i]) {
          const lineGeo = rayLines.current[i].geometry as THREE.BufferGeometry
          const pos = lineGeo.attributes.position.array as Float32Array
          pos[3] = -Math.sin(RAY_ANGLES[i]) * dist
          pos[4] = 0.5
          pos[5] = -Math.cos(RAY_ANGLES[i]) * dist
          lineGeo.attributes.position.needsUpdate = true

          const mat = rayLines.current[i].material as THREE.LineBasicMaterial
          const ratio = dist / MAX_RAY_DISTANCE
          mat.color.setRGB(1 - ratio, ratio, 0)
        }
      }

      // 3. Neural Network Feedforward
      if (brain && !damaged.current) {
        const outputs = NeuralNetwork.feedForward(inputs, brain)
        
        // Autopilot Cruise: forward drive active, network steers & brakes
        const shouldBrake = outputs[1] === 1 && outputs[0] === 0
        physics.controls.forward = !shouldBrake
        physics.controls.reverse = shouldBrake
        physics.controls.left = outputs[2] === 1
        physics.controls.right = outputs[3] === 1
      }

      physics.update()

      // 4. Throttled UI Telemetry (10 updates/sec instead of 60 to prevent React re-render lag)
      const now = clock.getElapsedTime()
      if (isBest && (now - lastDispatchTime.current > 0.1)) {
        lastDispatchTime.current = now
        window.dispatchEvent(new CustomEvent('fsd-sensors', { 
          detail: { 
            readings, 
            steering: physics.steeringAngle, 
            speed: physics.speed,
            isBraking: physics.isBraking,
            checkpoints: checkpointsPassed.current
          } 
        }))
      }

      // Telemetry callback
      onTelemetry?.({
        id,
        fitness: fitness.current,
        checkpoints: checkpointsPassed.current,
        damaged: damaged.current,
        readings,
        steering: physics.steeringAngle,
        speed: physics.speed,
        isBraking: physics.isBraking
      })
    }

    // Update 3D Group Transform
    if (groupRef.current) {
      groupRef.current.position.x = physics.x
      groupRef.current.position.z = physics.y
      groupRef.current.rotation.y = physics.angle
    }

    // Front Wheel Steering Animation
    if (frontLeftWheel.current && frontRightWheel.current) {
      const visualSteering = (physics.steeringAngle / physics.maxSteeringAngle) * (Math.PI / 6)
      frontLeftWheel.current.rotation.y = visualSteering
      frontRightWheel.current.rotation.y = visualSteering
    }
  })

  return (
    <group ref={groupRef}>
      {/* Sensor Lines (ONLY for the leader) */}
      {isBest && RAY_ANGLES.map((_, i) => (
        <line key={i} ref={(el) => { if (el) rayLines.current[i] = el }}>
          <bufferGeometry attach="geometry">
            <bufferAttribute
              attach="attributes-position"
              count={2}
              array={new Float32Array(6)}
              itemSize={3}
            />
          </bufferGeometry>
          <lineBasicMaterial attach="material" color="#00ff00" linewidth={2} />
        </line>
      ))}

      {/* Main Car Body (Shared Geometry) */}
      <mesh 
        geometry={sharedBodyGeo} 
        material={isBest ? sharedLeaderMat : sharedGhostMat} 
        position={[0, 0.5, 0]} 
        castShadow={isBest}
      />
      
      {/* Cabin / Glass (Shared Geometry) */}
      <mesh 
        geometry={sharedCabinGeo} 
        material={sharedCabinMat} 
        position={[0, 1.25, -0.5]} 
      />

      {/* 4 Wheels (Shared Geometry) */}
      <mesh ref={frontRightWheel} geometry={sharedWheelGeo} material={sharedWheelMat} position={[1.1, 0, -1.2]} />
      <mesh ref={frontLeftWheel} geometry={sharedWheelGeo} material={sharedWheelMat} position={[-1.1, 0, -1.2]} />
      <mesh geometry={sharedWheelGeo} material={sharedWheelMat} position={[1.1, 0, 1.2]} />
      <mesh geometry={sharedWheelGeo} material={sharedWheelMat} position={[-1.1, 0, 1.2]} />

      {/* Taillights */}
      <mesh 
        geometry={sharedTailLightGeo} 
        material={physics.isBraking ? sharedBrakeMat : sharedIdleTailMat} 
        position={[0.8, 0.5, 2.01]} 
      />
      <mesh 
        geometry={sharedTailLightGeo} 
        material={physics.isBraking ? sharedBrakeMat : sharedIdleTailMat} 
        position={[-0.8, 0.5, 2.01]} 
      />
    </group>
  )
}
