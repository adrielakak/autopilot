export type Point2D = [number, number];

export type Segment2D = [Point2D, Point2D];

export interface LidarHit {
  x: number;
  y: number;
  dist: number;
}

export interface SemanticRayImpact {
  wall: LidarHit;
  npc: LidarHit;
  stop: LidarHit;
}

export type CarStatus = 'STOPPING' | 'STOP_DONE' | 'CRUISING';

export interface BestCarState {
  x: number;
  y: number;
  angle: number;
  speed: number;
  braking: boolean;
  steering: number;
  acceleration: number;
  lidar: number[];
  impacts: SemanticRayImpact[];
  fitness: number;
  checkpoints: number;
  laps: number;
  stop_rule_fulfilled: boolean;
  in_stop_zone: boolean;
  status: CarStatus;
}

export interface TrafficCarState {
  x: number;
  y: number;
  angle: number;
  speed: number;
  width: number;
  height: number;
}

export interface GhostCarState {
  x: number;
  y: number;
  angle: number;
}

export interface GenerationMetric {
  generation: number;
  bestFitness: number;
  avgFitness: number;
  maxCheckpoints: number;
  maxLaps: number;
  speciesCount: number;
}

export interface StopZoneData {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MapData {
  version: number;
  size: number;
  roadWidth: number;
  outerBounds: Point2D[];
  innerBounds: Point2D[];
  centerline: Point2D[];
  walls: Segment2D[];
  stopZone: StopZoneData;
  checkpoints: Segment2D[];
}

export interface SimState {
  generation: number;
  populationSize: number;
  alive: number;
  ticks: number;
  paused: boolean;
  speedMultiplier: number;
  speciesCount: number;
  allTimeBestFitness: number;
  allTimeBestCheckpoints: number;
  allTimeBestLaps: number;
  history: GenerationMetric[];
  trafficCars: TrafficCarState[];
  bestCar: BestCarState | null;
  otherAiCars: GhostCarState[];
  mapVersion: number;
  map?: MapData;
}

export type SimCommandAction =
  | 'force_next_gen'
  | 'toggle_pause'
  | 'pause'
  | 'resume'
  | 'set_speed'
  | 'reset'
  | 'request_state';

export interface SimCommand {
  action: SimCommandAction;
  speed?: number;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';
