# AutoPilot FSD — Simulation de conduite autonome par NEAT

Simulation temps réel d'agents conducteurs autonomes combinant un moteur physique 2D avec LIDAR sémantique 15 canaux, l'algorithme neuro-évolutionnaire **NEAT** (`neat-python`), un serveur **FastAPI / WebSockets** et une interface de télémétrie **React 19 + TypeScript + Three.js**.

## Fonctionnalités principales

- **Circuit fermé octogonal** (`800 × 800`, largeur de voie `140 px`) avec 13 checkpoints séquentiels multi-tours, zone **STOP** réglementaire et trafic transversal **NPC** dynamique.
- **Physique et collisions exactes** : détection de collision cercle-segment, contrôle balayé anti-tunneling, intersection exacte cercle-OBB contre les véhicules NPC et LIDAR sémantique 5 rayons × 3 canaux (`Mur`, `NPC`, `STOP`).
- **Serveur FastAPI asynchrone** (`main.py`) : boucle de simulation cadencée à 60 FPS, diffusion WebSocket (`/ws/fsd` et `/ws`), API REST (`/health`, `/api/state`, `/api/sim/command`) et contrôle temps réel (`1×` à `10×`, pause, génération suivante, réinitialisation).
- **Visualisation 2D HiDPI & 3D WebGL** :
  - **2D Télémétrie** : chaussée octogonale exacte, ligne médiane, faisceaux LIDAR sémantiques, essaim fantôme NEAT et suivi caméra.
  - **3D WebGL** : scène Three.js / React Three Fiber chargée à la demande et synchronisée en direct sur les coordonnées backend.
  - **Courbe d'évolution & Inspecteur LIDAR** : suivi historique des générations (`bestFitness`, `avgFitness`) et détails des 15 canaux capteurs.

## Démarrage rapide

### 1. Backend Python

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

### 2. Frontend React / Vite

```bash
npm install
npm run dev
```

Ouvrez ensuite [http://localhost:5173](http://localhost:5173).

## Tests et qualité

```bash
# Backend
pytest -v
ruff check .

# Frontend
npm run lint
npm run build
```

## Architecture

- `physics.py` — Primitives géométriques 2D, circuit octogonal, véhicules NPC, LIDAR sémantique et collisions exactes.
- `ai_engine.py` — `SimulationManager` & `AgentState` orchestrant l'évaluation NEAT, les tours multiples et la règle STOP.
- `main.py` — Application FastAPI avec gestion de cycle de vie, endpoints REST et diffusion WebSocket.
- `config-feedforward.txt` — Hyperparamètres NEAT (`pop_size = 50`, `16` entrées, `2` sorties).
- `src/` — Interface React 19 + Tailwind v4 (`Canvas2DView`, `Scene3DView`, `FitnessChart`, `LidarPanel`, `useSimulationSocket`).
- `tests/` — Suite automatisée `pytest` couvrant physique, NEAT et endpoints FastAPI / WebSocket.
