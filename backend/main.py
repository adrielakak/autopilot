import asyncio
import math
import time
import neat
import websockets
import threading
import json
import os
import sys

active_websockets = set()

async def handler(websocket):
    active_websockets.add(websocket)
    try:
        async for message in websocket:
            pass
    finally:
        active_websockets.remove(websocket)

async def main_server():
    print("Starting WebSocket server on port 8000...", flush=True)
    async with websockets.serve(handler, "0.0.0.0", 8000):
        print("WebSocket server started", flush=True)
        await asyncio.Future()  # run forever

def line_intersect(p1, p2, p3, p4):
    x1, y1 = p1; x2, y2 = p2
    x3, y3 = p3; x4, y4 = p4
    den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    if den == 0:
        return None
    t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
    u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den
    if 0 <= t <= 1 and 0 <= u <= 1:
        return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))
    return None

def distance(p1, p2):
    return math.hypot(p2[0] - p1[0], p2[1] - p1[1])

class Track:
    def __init__(self):
        self.inner_bounds = [(250, 200), (550, 200), (550, 400), (250, 400)]
        self.outer_bounds = [(100, 100), (700, 100), (700, 500), (100, 500)]
        self.segments = self._build_segments(self.inner_bounds) + self._build_segments(self.outer_bounds)
        self.checkpoints = [
            (200, 150), (400, 150), (625, 150),
            (625, 300), (625, 450), (400, 450),
            (175, 450), (175, 300)
        ]
        
    def _build_segments(self, bounds):
        return [(bounds[i], bounds[(i + 1) % len(bounds)]) for i in range(len(bounds))]

class Car:
    def __init__(self, car_id, genome, net):
        self.id = car_id
        self.genome = genome
        self.net = net
        self.x = 200
        self.y = 150
        self.angle = 0
        self.speed = 0
        self.alive = True
        self.fitness = 0
        self.radars = []
        self.impacts = []
        self.last_checkpoint = 1
        self.time_alive = 0

    def update(self, track, dt):
        if not self.alive:
            return

        self.time_alive += dt
        
        self.radars = []
        self.impacts = []
        angles = [-math.pi/2, -math.pi/4, 0, math.pi/4, math.pi/2]
        for a in angles:
            ray_angle = self.angle + a
            p2 = (self.x + math.cos(ray_angle) * 500, self.y + math.sin(ray_angle) * 500)
            
            min_dist = 500
            impact_pt = p2
            for seg_start, seg_end in track.segments:
                intersect = line_intersect((self.x, self.y), p2, seg_start, seg_end)
                if intersect:
                    dist = distance((self.x, self.y), intersect)
                    if dist < min_dist:
                        min_dist = dist
                        impact_pt = intersect
            self.radars.append(min_dist)
            self.impacts.append({"x": impact_pt[0], "y": impact_pt[1]})
            
            if min_dist < 10:
                self.alive = False

        if not self.alive:
            return

        inputs = [r / 500.0 for r in self.radars] + [self.speed / 20.0]
        outputs = self.net.activate(inputs)
        
        steering = outputs[0]
        accel_brake = outputs[1]

        self.angle += steering * 0.1 * (self.speed / 10.0 if self.speed != 0 else 0)
        self.speed += accel_brake * 0.5
        self.speed *= 0.92
        self.speed = max(-5, min(self.speed, 20))

        self.x += math.cos(self.angle) * self.speed
        self.y += math.sin(self.angle) * self.speed

        cp = track.checkpoints[self.last_checkpoint % len(track.checkpoints)]
        if distance((self.x, self.y), cp) < 80:
            self.fitness += 100
            self.last_checkpoint += 1
            self.time_alive = 0
            
        if self.time_alive > 5.0:
            self.alive = False

        self.fitness += self.speed * 0.1
        self.genome.fitness = self.fitness

current_generation = 1

def broadcast_state(track, cars, generation):
    if not active_websockets:
        return
    state = {
        "generation": generation,
        "track_outer": track.outer_bounds + [track.outer_bounds[0]],
        "track_inner": track.inner_bounds + [track.inner_bounds[0]],
        "cars": [
            {
                "id": c.id, 
                "x": c.x, 
                "y": c.y, 
                "angle": c.angle, 
                "alive": c.alive, 
                "fitness": c.fitness,
                "checkpoints": c.last_checkpoint,
                "speed": c.speed,
                "impacts": c.impacts
            } for c in cars
        ]
    }
    msg = json.dumps(state)
    websockets.broadcast(active_websockets, msg)

def eval_genomes(genomes, config):
    global current_generation
    track = Track()
    cars = []
    
    for genome_id, genome in genomes:
        genome.fitness = 0
        net = neat.nn.FeedForwardNetwork.create(genome, config)
        cars.append(Car(genome_id, genome, net))
    
    dt = 1/60.0
    while True:
        alive_cars = [c for c in cars if c.alive]
        if not alive_cars:
            break
            
        for car in alive_cars:
            car.update(track, dt)
            
        try:
            broadcast_state(track, cars, current_generation)
        except Exception as e:
            pass
            
        time.sleep(dt)
        
    current_generation += 1

def run_neat():
    print("NEAT loop starting...", flush=True)
    config_path = os.path.join(os.path.dirname(__file__), 'config-feedforward.txt')
    config = neat.Config(neat.DefaultGenome, neat.DefaultReproduction,
                         neat.DefaultSpeciesSet, neat.DefaultStagnation,
                         config_path)
    p = neat.Population(config)
    p.add_reporter(neat.StdOutReporter(True))
    p.run(eval_genomes, 300)
    print("NEAT loop ended.", flush=True)

if __name__ == "__main__":
    print("Starting NEAT thread...", flush=True)
    threading.Thread(target=run_neat, daemon=True).start()
    try:
        asyncio.run(main_server())
    except KeyboardInterrupt:
        sys.exit(0)
