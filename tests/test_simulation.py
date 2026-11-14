import json
import math
import os
import sys

from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ai_engine import SimulationManager
from main import create_app
from physics import (
    Car,
    IntersectionMap,
    TrafficCar,
    circle_intersects_obb,
    point_distance,
    point_to_segment_distance_sq,
    ray_segment_intersection_dist,
    segment_intersection,
)


def test_geometry_primitives_and_raycaster_parity():
    p_hit = segment_intersection((0.0, 0.0), (10.0, 0.0), (5.0, -5.0), (5.0, 5.0))
    assert p_hit is not None
    assert math.isclose(p_hit[0], 5.0, rel_tol=1e-6)
    assert math.isclose(p_hit[1], 0.0, abs_tol=1e-6)

    dist = ray_segment_intersection_dist(0.0, 0.0, 1.0, 0.0, 10.0, 5.0, -5.0, 5.0, 5.0)
    assert dist is not None
    assert math.isclose(dist, point_distance((0.0, 0.0), p_hit), rel_tol=1e-6)

    assert ray_segment_intersection_dist(0.0, 0.0, 1.0, 0.0, 4.9, 5.0, -5.0, 5.0, 5.0) is None
    assert math.isclose(point_to_segment_distance_sq(3.0, 4.0, 0.0, 0.0, 0.0, 10.0), 9.0, rel_tol=1e-6)


def test_car_collision_prevents_tunneling_and_blind_spots():
    env = IntersectionMap()

    # Voiture proche du mur droit à x=760 sans rayon pointant à ±22.5°
    car = Car(x=754.0, y=400.0, angle=-math.pi / 8.0)
    assert car.check_collision(env) is True

    # Passage balayé traversant complètement le mur haut (y=40) en un seul tick
    fast_car = Car(x=300.0, y=35.0, angle=-math.pi / 2.0)
    assert fast_car.check_collision(env, prev_pos=(300.0, 45.0)) is True

    # Collision OBB exacte avec un NPC tourné à 90°
    npc = TrafficCar(start_x=200.0, start_y=200.0, angle=math.pi / 2.0, speed=0.0, width=36.0, height=18.0)
    assert circle_intersects_obb(215.0, 200.0, 10.0, npc.x, npc.y, npc.angle, 18.0, 9.0) is True
    assert circle_intersects_obb(225.0, 200.0, 5.0, npc.x, npc.y, npc.angle, 18.0, 9.0) is False


def test_simulation_manager_controls_and_multi_lap_reset():
    sim = SimulationManager()
    assert len(sim.agents) == 50
    assert sim.paused is False
    assert sim.speed_multiplier == 1

    # Vérifie l'initialisation immédiate du LIDAR t=0 (pas tous à sensor_range)
    assert any(d < sim.agents[0].car.sensor_range for d in sim.agents[0].car.semantic_distances)

    # Contrôles pause / vitesse / frame
    assert sim.toggle_pause() is True
    ticks_before = sim.tick_count
    sim.step_frame()
    assert sim.tick_count == ticks_before

    assert sim.toggle_pause() is False
    assert sim.set_speed_multiplier(5) == 5
    sim.step_frame()
    assert sim.tick_count == ticks_before + 5

    # Passage forcé à la génération suivante + historique enregistré
    sim.force_next_generation()
    assert sim.generation == 2
    assert len(sim.history) == 1

    # Réinitialisation complète
    sim.reset_simulation()
    assert sim.generation == 1
    assert sim.history == []
    assert sim.all_time_best_fitness == 0.0


def test_stop_rule_and_lap_wraparound_behavior():
    sim = SimulationManager()
    agent = sim.agents[0]
    num_cp = len(sim.map.checkpoints)
    assert num_cp == 13

    # Simule un tour complet déjà complété au niveau STOP + checkpoints 0..11 franchis
    agent.stop_rule_fulfilled = True
    agent.stop_bonus_awarded = True
    agent.was_in_stop_zone = True
    agent.checkpoints_passed = num_cp - 1

    # Place la voiture juste avant le dernier checkpoint ((40, 450) -> (180, 450)), roulant vers le haut
    agent.car.x = 110.0
    agent.car.y = 452.0
    agent.car.angle = -math.pi / 2.0
    agent.car.speed = 4.0

    # Force le réseau à garder une sortie neutre vers l'avant
    class ForwardNet:
        def activate(self, _inputs):
            return [0.0, 1.0]

    for idx, other in enumerate(sim.agents):
        if idx != 0:
            other.alive = False
    agent.net = ForwardNet()
    agent.car.update_semantic_lidar(sim.map, compute_impacts=False)

    sim.step()
    assert agent.alive is True
    assert agent.checkpoints_passed == num_cp
    assert agent.laps == 1
    # Le STOP doit être réarmé pour le deuxième tour
    assert agent.stop_rule_fulfilled is False
    assert agent.was_in_stop_zone is False


def test_fastapi_rest_and_websocket_endpoints():
    sim = SimulationManager()
    app = create_app(sim_manager=sim)

    with TestClient(app) as client:
        health = client.get("/health")
        assert health.status_code == 200
        body = health.json()
        assert body["status"] == "online"
        assert body["generation"] == 1

        state_resp = client.get("/api/state")
        assert state_resp.status_code == 200
        state_json = state_resp.json()
        assert "map" in state_json
        assert len(state_json["map"]["outerBounds"]) == 8
        assert len(state_json["map"]["checkpoints"]) == 13

        cmd_resp = client.post("/api/sim/command", json={"action": "set_speed", "speed": 10})
        assert cmd_resp.status_code == 200
        assert cmd_resp.json()["speedMultiplier"] == 10

        bad_cmd = client.post("/api/sim/command", json={"action": "set_speed"})
        assert bad_cmd.status_code == 422

        with client.websocket_connect("/ws/fsd") as ws:
            initial = json.loads(ws.receive_text())
            assert "map" in initial
            assert initial["speedMultiplier"] == 10

            ws.send_text("force_next_gen")
            next_msg = json.loads(ws.receive_text())
            assert next_msg["generation"] >= 2

            ws.send_text(json.dumps({"action": "reset"}))
            reset_msg = json.loads(ws.receive_text())
            assert reset_msg["generation"] == 1
            assert "map" in reset_msg
