<div align="center">

# 🚗 AutoPilot FSD

**A real-time Full Self-Driving simulation powered by NEAT genetic algorithms, semantic LIDAR, and a live 3D renderer.**

[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![Three.js](https://img.shields.io/badge/Three.js-0.186-black?logo=three.js)](https://threejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

![demo](https://raw.githubusercontent.com/adrielakak/autopilot/main/docs/demo.gif)

</div>

---

## ✨ What is this?

AutoPilot FSD is a **full-stack autonomous driving simulation** that evolves a population of 50 AI cars through a cross-intersection using the **NEAT** (NeuroEvolution of Augmenting Topologies) genetic algorithm.

Each car is equipped with a **15-channel semantic LIDAR** (5 rays × 3 obstacle classes: walls, NPC traffic, stop zone) and learns, generation by generation, to:

- 🚦 **Stop** at the STOP sign before the intersection
- 🚗 **Avoid** cross-traffic NPC vehicles in real time
- 🏁 **Navigate** the full intersection and exit on the other side

The simulation runs at **60 ticks/second** on the Python backend and streams live telemetry to the browser over **WebSocket**.

---

## 🏗️ Architecture

```
autopilot/
├── main.py               # FastAPI server + WebSocket broadcaster (60 FPS loop)
├── ai_engine.py          # SimulationManager: NEAT lifecycle, reward shaping
├── physics.py            # Kinematic car model, semantic LIDAR, NPC traffic, walls
├── config-feedforward.txt# NEAT hyper-parameters (pop=50, inputs=16, outputs=2)
├── requirements.txt      # Python dependencies
│
└── src/                  # React + TypeScript frontend
    ├── App.tsx           # Canvas 2D renderer + WebSocket client + dashboard UI
    ├── components/
    │   ├── Car.tsx       # Three.js 3D car mesh with wheel animation
    │   └── Track.tsx     # CatmullRom circuit with checkpoint gates
    └── core/
        ├── CarPhysics.ts # Kinematic car physics (frontend 3D mode)
        ├── NeuralNetwork.ts # Feedforward NN (frontend standalone mode)
        └── TrackData.ts  # Spline track + pre-computed 2D raycaster
```

### Data flow

```
Python backend (60 FPS)
  └─ physics.py  →  ai_engine.py  →  main.py
                                      │
                                  WebSocket /ws/fsd
                                      │
Browser frontend
  └─ App.tsx (Canvas 2D) ← JSON state ─┘
       ├─ Intersection map + walls
       ├─ Best car telemetry (LIDAR, speed, steering, status)
       ├─ Ghost AI cars (50 agents)
       └─ NPC traffic cars
```

---

## 🧠 How the AI works

### NEAT Algorithm

The project uses [**neat-python**](https://neat-python.readthedocs.io/) to evolve a population of neural networks:

| Parameter | Value |
|-----------|-------|
| Population | 50 genomes |
| Inputs | **16** (15 LIDAR distances + 1 speed) |
| Outputs | **2** (steering ∈ [-1,1], acceleration ∈ [-1,1]) |
| Activation | `tanh` |
| Initial topology | Fully connected, no hidden nodes |

### Semantic LIDAR

Each car casts **5 rays** at angles `[-90°, -45°, 0°, +45°, +90°]`. Each ray returns **3 distances**:

| Channel | Detects |
|---------|---------|
| Wall distance | Road boundary walls |
| NPC distance | Cross-traffic vehicles |
| Stop distance | STOP zone rectangle |

→ **15 inputs** total, normalised to [0, 1].

### Reward Shaping

| Event | Reward |
|-------|--------|
| Checkpoint crossed | **+10 pts** |
| Forward movement | **+speed × 0.05** / tick |
| Respectful STOP (≥ 30 ticks at speed < 0.5) | **+50 pts** |
| Wall / NPC collision | **−100 pts** → eliminated |
| STOP zone bypass (no stop) | **−200 pts** → eliminated |
| Stagnation (> 250 ticks, no checkpoint) | eliminated |

---

## 🚀 Getting Started

### Prerequisites

- **Python 3.11+**
- **Node.js 20+**

### 1. Clone

```bash
git clone https://github.com/adrielakak/autopilot.git
cd autopilot
```

### 2. Backend (Python)

```bash
# Create a virtual environment
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start the simulation server
python main.py
# → Server running on http://0.0.0.0:8000
# → WebSocket: ws://localhost:8000/ws/fsd
```

### 3. Frontend (React)

```bash
# In a second terminal
npm install
npm run dev
# → http://localhost:5173
```

Open your browser at **http://localhost:5173** and watch the evolution in real time.

---

## 🖥️ Dashboard

| Panel | Description |
|-------|-------------|
| **Canvas** | 2D top-down view: road, stop zone, NPC traffic (amber), ghost AI cars (translucent), best car (white + cyan glow), LIDAR rays colour-coded by distance |
| **LIDAR Perception** | 5 wall-distance bars, colour shifts green → yellow → orange → red |
| **Brain Decisions** | Live speed (km/h), steering angle, current status (CRUISING / STOPPING / STOP_DONE) |
| **NEAT Stats** | Generation, alive count, checkpoints, all-time best fitness, current leader fitness |
| **Force Next Gen** | Sends `force_next_gen` via WebSocket — kills all agents and starts reproduction immediately |

---

## 🔌 WebSocket API

**Endpoint:** `ws://localhost:8000/ws/fsd`

### Server → Client (JSON, ~60 FPS)

```jsonc
{
  "generation": 7,
  "alive": 23,
  "trafficCars": [{ "x": 412, "y": 435, "angle": 0, "speed": 3.2, "width": 36, "height": 18 }],
  "bestCar": {
    "x": 435, "y": 540, "angle": -1.571, "speed": 2.1, "braking": false,
    "steering": -0.03, "acceleration": 0.4,
    "lidar": [148, 150, 142, 150, 149, 63, 150, 44, 150, 150, 148, 150, 150, 150, 148],
    "impacts": [/* 5 × {wall, npc, stop} hit points */],
    "fitness": 84.3, "checkpoints": 4,
    "stop_rule_fulfilled": false, "in_stop_zone": false,
    "status": "CRUISING"
  },
  "otherAiCars": [{ "x": 431, "y": 544 }, /* ... */],
  "map": {
    "size": 800, "roadWidth": 140,
    "walls": [/* segments */],
    "stopZone": { "x": 400, "y": 480, "width": 70, "height": 60 },
    "checkpoints": [/* 8 segments */]
  }
}
```

### Client → Server

```jsonc
{ "action": "force_next_gen" }
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| AI / Simulation | Python · [neat-python](https://neat-python.readthedocs.io/) |
| Backend | [FastAPI](https://fastapi.tiangolo.com/) · [Uvicorn](https://www.uvicorn.org/) · WebSockets |
| Frontend | [React 19](https://react.dev/) · [TypeScript](https://typescriptlang.org/) · Canvas 2D API |
| 3D (optional) | [Three.js](https://threejs.org/) · [@react-three/fiber](https://docs.pmnd.rs/react-three-fiber) |
| Bundler | [Vite 5](https://vitejs.dev/) |

---

## 📂 Key Files Reference

| File | Role |
|------|------|
| [`main.py`](main.py) | FastAPI app, WebSocket hub, async 60 FPS game loop |
| [`ai_engine.py`](ai_engine.py) | NEAT lifecycle, agent state, reward function |
| [`physics.py`](physics.py) | `Car`, `TrafficCar`, `IntersectionMap`, `StopZone`, LIDAR raycaster |
| [`config-feedforward.txt`](config-feedforward.txt) | NEAT genome & reproduction hyper-parameters |
| [`src/App.tsx`](src/App.tsx) | WebSocket client, Canvas 2D renderer, dashboard UI |
| [`src/core/TrackData.ts`](src/core/TrackData.ts) | CatmullRom spline track + zero-allocation 2D raycaster |
| [`src/components/Car.tsx`](src/components/Car.tsx) | Three.js 3D car mesh (shared geometries, wheel animation) |

---

## 🗺️ Roadmap

- [ ] Save / load best genome to continue training across sessions
- [ ] Multiple configurable tracks (highway, roundabout, T-junction)
- [ ] Real-time fitness chart (recharts)
- [ ] Toggle between 2D canvas view and 3D Three.js renderer
- [ ] Pedestrian obstacles with semantic LIDAR class

---

## 📄 License

MIT © 2026 — feel free to fork, star ⭐ and experiment!
