import asyncio
import json
from contextlib import asynccontextmanager
from typing import Set, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from ai_engine import SimulationManager

# Instance singleton du gestionnaire de simulation
_sim_instance: Optional[SimulationManager] = None


def get_sim() -> SimulationManager:
    """Retourne l'instance unique du SimulationManager (initialisation paresseuse)."""
    global _sim_instance
    if _sim_instance is None:
        _sim_instance = SimulationManager()
    return _sim_instance


# Ensemble des clients connectés aux WebSockets
connected_clients: Set[WebSocket] = set()


async def simulation_loop():
    """
    Boucle physique et IA continue s'exécutant à environ 60 ticks par seconde (16.6ms).
    Diffuse en temps réel l'état sérialisé du monde à tous les clients connectés.
    """
    sim = get_sim()
    print("[FSD Backend] Boucle de simulation IA démarrée (60 FPS).", flush=True)
    dt = 1.0 / 60.0

    while True:
        try:
            # 1. Avance la simulation d'un tick
            sim.step()

            # 2. Diffusion WebSocket si des clients sont connectés
            if connected_clients:
                state_data = sim.get_state()
                message = json.dumps(state_data)

                # Diffusion sécurisée avec éviction automatique des clients déconnectés
                for client in list(connected_clients):
                    try:
                        await client.send_text(message)
                    except Exception:
                        connected_clients.discard(client)
        except Exception as e:
            print(f"[FSD Backend] Erreur dans la boucle de simulation: {e}", flush=True)

        await asyncio.sleep(dt)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Cycle de vie FastAPI démarrant la simulation asynchrone dès le lancement."""
    # Pré-chauffe le SimulationManager au démarrage du serveur
    get_sim()
    loop_task = asyncio.create_task(simulation_loop())
    yield
    loop_task.cancel()


app = FastAPI(
    title="Tesla FSD Simulation Backend",
    description="Backend IA autonome NEAT avec LIDAR Sémantique et trafic urbain",
    lifespan=lifespan
)

# Configuration CORS complète
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def health_check():
    """Vérification de l'état de santé du serveur et de la simulation."""
    sim = get_sim()
    return {
        "status": "online",
        "system": "Tesla FSD Semantic NEAT Simulation",
        "generation": sim.generation,
        "connected_clients": len(connected_clients)
    }


async def handle_websocket_connection(websocket: WebSocket):
    """
    Logique commune de gestion des connexions WebSocket.
    Prend en charge la diffusion continue et l'écoute des commandes utilisateur.
    """
    await websocket.accept()
    connected_clients.add(websocket)
    sim = get_sim()
    print(f"[WebSocket] Nouveau client connecté. Total: {len(connected_clients)}", flush=True)

    try:
        # Envoi immédiat du 1er état dès la connexion
        initial_state = json.dumps(sim.get_state())
        await websocket.send_text(initial_state)

        while True:
            # Écoute des messages ou commandes envoyés par le client
            data = await websocket.receive_text()
            
            # Traitement de la commande "force_next_gen" (chaîne brute ou JSON)
            is_force_command = False
            if data == "force_next_gen":
                is_force_command = True
            else:
                try:
                    parsed = json.loads(data)
                    if isinstance(parsed, dict) and parsed.get("action") == "force_next_gen":
                        is_force_command = True
                except Exception:
                    pass

            if is_force_command:
                print(f"[WebSocket] Commande force_next_gen reçue (Génération {sim.generation} -> {sim.generation + 1})", flush=True)
                sim.force_next_generation()

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[WebSocket] Exception client: {e}", flush=True)
    finally:
        connected_clients.discard(websocket)
        print(f"[WebSocket] Client déconnecté. Total restant: {len(connected_clients)}", flush=True)


@app.websocket("/ws")
async def websocket_ws(websocket: WebSocket):
    """Endpoint WebSocket principal selon la spécification."""
    await handle_websocket_connection(websocket)


@app.websocket("/ws/fsd")
async def websocket_ws_fsd(websocket: WebSocket):
    """Endpoint WebSocket alternatif pour compatibilité avec l'ensemble des clients front-end."""
    await handle_websocket_connection(websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")

