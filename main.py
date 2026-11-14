import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from typing import Any, Literal

import uvicorn
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from ai_engine import SimulationManager

logger = logging.getLogger("autopilot.backend")
if not logger.handlers:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )


class CommandRequest(BaseModel):
    """Schéma de commande pour piloter la simulation NEAT à distance."""

    action: Literal[
        "force_next_gen",
        "toggle_pause",
        "pause",
        "resume",
        "set_speed",
        "reset",
    ]
    speed: int | None = Field(default=None, ge=1, le=10)


class CommandResponse(BaseModel):
    """Réponse structurée après exécution d'une commande simulation."""

    ok: bool
    action: str
    generation: int
    paused: bool
    speedMultiplier: int


class HealthResponse(BaseModel):
    """Statut de santé du serveur FastAPI et du moteur NEAT."""

    status: str
    system: str
    generation: int
    alive: int
    paused: bool
    speedMultiplier: int
    connectedClients: int
    allTimeBestFitness: float


async def broadcast_state(app: FastAPI, include_map: bool = False) -> None:
    """Sérialise et diffuse l'état courant à l'ensemble des clients WebSocket."""
    clients: set[WebSocket] = app.state.connected_clients
    if not clients:
        return

    sim: SimulationManager = app.state.sim
    payload = json.dumps(sim.get_state(include_map=include_map))
    stale_clients: list[WebSocket] = []

    for client in list(clients):
        try:
            await client.send_text(payload)
        except (WebSocketDisconnect, RuntimeError, ConnectionError, OSError):
            stale_clients.append(client)

    for stale in stale_clients:
        clients.discard(stale)


def apply_simulation_command(
    sim: SimulationManager,
    action: str,
    speed: int | None = None,
) -> bool:
    """
    Applique une commande utilisateur sur le SimulationManager.
    Retourne True si la carte doit être renvoyée avec le prochain état.
    """
    if action == "force_next_gen":
        sim.force_next_generation()
        return False
    if action == "toggle_pause":
        sim.toggle_pause()
        return False
    if action == "pause":
        sim.set_paused(True)
        return False
    if action == "resume":
        sim.set_paused(False)
        return False
    if action == "set_speed":
        if speed is None:
            raise ValueError("Le paramètre 'speed' est requis pour 'set_speed'.")
        sim.set_speed_multiplier(int(speed))
        return False
    if action == "reset":
        sim.reset_simulation()
        return True
    raise ValueError(f"Action inconnue : {action}")


async def simulation_loop(app: FastAPI) -> None:
    """Boucle asynchrone cadencée à ~60 FPS pilotant la simulation et la diffusion."""
    sim: SimulationManager = app.state.sim
    logger.info("Boucle de simulation IA démarrée (60 FPS cibles).")
    target_dt = 1.0 / 60.0

    while True:
        frame_start = time.perf_counter()
        try:
            if not sim.paused:
                sim.step_frame()
                await broadcast_state(app, include_map=False)
        except asyncio.CancelledError:
            raise
        except (RuntimeError, ValueError, KeyError, TypeError, OSError):
            logger.exception("Erreur dans simulation_loop")

        elapsed = time.perf_counter() - frame_start
        await asyncio.sleep(max(0.001, target_dt - elapsed))


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Cycle de vie FastAPI : initialise l'état et arrête proprement la boucle."""
    if not hasattr(app.state, "sim") or app.state.sim is None:
        app.state.sim = SimulationManager()
    if not hasattr(app.state, "connected_clients"):
        app.state.connected_clients = set()

    loop_task = asyncio.create_task(simulation_loop(app))
    app.state.loop_task = loop_task
    try:
        yield
    finally:
        loop_task.cancel()
        try:
            await loop_task
        except asyncio.CancelledError:
            pass
        logger.info("Boucle de simulation arrêtée proprement.")


def create_app(sim_manager: SimulationManager | None = None) -> FastAPI:
    """Fabrique d'application FastAPI configurée avec CORS, REST et WebSockets."""
    application = FastAPI(
        title="AutoPilot FSD Simulation Backend",
        description="Backend IA autonome NEAT avec LIDAR sémantique et circuit urbain",
        version="2.0.0",
        lifespan=lifespan,
    )

    application.state.sim = sim_manager
    application.state.connected_clients = set()

    application.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
    )

    @application.get("/", response_model=HealthResponse)
    @application.get("/health", response_model=HealthResponse)
    def health_check() -> HealthResponse:
        sim = _get_or_init_sim(application)
        alive = sum(1 for a in sim.agents if a.alive)
        return HealthResponse(
            status="online",
            system="AutoPilot FSD Semantic NEAT Simulation",
            generation=sim.generation,
            alive=alive,
            paused=sim.paused,
            speedMultiplier=sim.speed_multiplier,
            connectedClients=len(application.state.connected_clients),
            allTimeBestFitness=round(sim.all_time_best_fitness, 1),
        )

    @application.get("/api/state")
    def get_simulation_state() -> dict[str, Any]:
        sim = _get_or_init_sim(application)
        return sim.get_state(include_map=True)

    @application.post("/api/sim/command", response_model=CommandResponse)
    async def send_command(payload: CommandRequest) -> CommandResponse:
        sim = _get_or_init_sim(application)
        try:
            include_map = apply_simulation_command(sim, payload.action, payload.speed)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        await broadcast_state(application, include_map=include_map)
        return CommandResponse(
            ok=True,
            action=payload.action,
            generation=sim.generation,
            paused=sim.paused,
            speedMultiplier=sim.speed_multiplier,
        )

    @application.websocket("/ws")
    async def websocket_ws(websocket: WebSocket) -> None:
        await handle_websocket_connection(application, websocket)

    @application.websocket("/ws/fsd")
    async def websocket_ws_fsd(websocket: WebSocket) -> None:
        await handle_websocket_connection(application, websocket)

    return application


def _get_or_init_sim(app: FastAPI) -> SimulationManager:
    """Garantit qu'un SimulationManager existe (utile hors lifespan en tests)."""
    if getattr(app.state, "sim", None) is None:
        app.state.sim = SimulationManager()
    return app.state.sim


def _parse_ws_command(raw_data: str) -> tuple[str, int | None] | None:
    """Analyse une commande WebSocket brute ou JSON; retourne (action, speed)."""
    if raw_data == "force_next_gen":
        return ("force_next_gen", None)
    try:
        parsed = json.loads(raw_data)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None
    action = parsed.get("action")
    if not isinstance(action, str):
        return None
    speed = parsed.get("speed")
    return (action, int(speed) if isinstance(speed, (int, float)) else None)


async def handle_websocket_connection(app: FastAPI, websocket: WebSocket) -> None:
    """Gère la session WebSocket temps réel et les commandes interactives client."""
    await websocket.accept()
    clients: set[WebSocket] = app.state.connected_clients
    clients.add(websocket)
    sim = _get_or_init_sim(app)
    logger.info("Client WebSocket connecté (total=%d).", len(clients))

    try:
        await websocket.send_text(json.dumps(sim.get_state(include_map=True)))

        while True:
            raw_data = await websocket.receive_text()
            command = _parse_ws_command(raw_data)
            if command is None:
                continue

            action, speed = command
            if action == "request_state":
                await websocket.send_text(json.dumps(sim.get_state(include_map=True)))
                continue

            try:
                include_map = apply_simulation_command(sim, action, speed)
            except ValueError as exc:
                logger.warning("Commande WebSocket ignorée (%s): %s", action, exc)
                continue

            logger.info(
                "Commande '%s' appliquée (gen=%d, paused=%s, speed=%dx).",
                action,
                sim.generation,
                sim.paused,
                sim.speed_multiplier,
            )
            await broadcast_state(app, include_map=include_map)
    except WebSocketDisconnect:
        pass
    except (RuntimeError, ConnectionError, OSError) as exc:
        logger.warning("Exception WebSocket client: %s", exc)
    finally:
        clients.discard(websocket)
        logger.info("Client WebSocket déconnecté (restants=%d).", len(clients))


app = create_app()


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
