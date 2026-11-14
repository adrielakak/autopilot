import math
import os
from typing import Any

import neat

from physics import Car, IntersectionMap, segment_intersection

MAX_HISTORY_LEN = 120
VALID_SPEED_MULTIPLIERS = (1, 2, 5, 10)


class AgentState:
    """Suivi individuel des performances et règles de conduite d'un agent IA."""

    def __init__(self, car: Car, genome: Any, net: Any):
        self.car = car
        self.genome = genome
        self.net = net
        self.alive = True
        self.fitness = 0.0
        self.ticks_alive = 0
        self.checkpoints_passed = 0
        self.laps = 0
        self.last_progress_tick = 0

        # Règle du STOP (réinitialisée à chaque nouveau tour complet)
        self.was_in_stop_zone = False
        self.stopped_ticks_in_zone = 0
        self.stop_rule_fulfilled = False
        self.stop_bonus_awarded = False

    def reset_stop_state(self):
        """Réinitialise l'état de validation du panneau STOP pour le tour suivant."""
        self.was_in_stop_zone = False
        self.stopped_ticks_in_zone = 0
        self.stop_rule_fulfilled = False
        self.stop_bonus_awarded = False


class SimulationManager:
    """
    Gestionnaire centralisé de la simulation : synchronise l'environnement physique
    (circuit fermé, trafic NPC, zone STOP) et l'algorithme génétique NEAT.
    """

    def __init__(self, config_path: str | None = None):
        if config_path is None:
            config_path = os.path.join(os.path.dirname(__file__), "config-feedforward.txt")
        self.config_path = config_path

        self.config = neat.config.Config(
            neat.DefaultGenome,
            neat.DefaultReproduction,
            neat.DefaultSpeciesSet,
            neat.DefaultStagnation,
            self.config_path,
        )

        # Position initiale de l'IA : Voie Gauche du circuit (orientée vers le haut)
        self.start_x = 110.0
        self.start_y = 500.0
        self.start_angle = -math.pi / 2.0

        self.paused = False
        self.speed_multiplier = 1
        self.generation = 1
        self.tick_count = 0
        self.map_version = 1

        self.all_time_best_fitness = 0.0
        self.all_time_best_checkpoints = 0
        self.all_time_best_laps = 0
        self.history: list[dict[str, Any]] = []

        self.map = IntersectionMap(size=800.0, road_width=140.0)
        self._cached_map_data = self._build_map_data()
        self.agents: list[AgentState] = []

        self._init_population()
        self._init_generation()

    def _init_population(self):
        """Crée ou réinitialise la population NEAT et ses rapporteurs."""
        self.population = neat.Population(self.config)
        self.population.add_reporter(neat.StdOutReporter(True))
        self.stats = neat.StatisticsReporter()
        self.population.add_reporter(self.stats)
        self.generation = 1
        self.population.reporters.start_generation(self.generation)

    def _build_map_data(self) -> dict[str, Any]:
        """Sérialise les données statiques de la piste pour le client."""
        return {
            "version": self.map_version,
            "size": self.map.size,
            "roadWidth": self.map.road_width,
            "outerBounds": [list(pt) for pt in self.map.outer_bounds],
            "innerBounds": [list(pt) for pt in self.map.inner_bounds],
            "centerline": [list(pt) for pt in self.map.centerline],
            "walls": [[list(w.p1), list(w.p2)] for w in self.map.walls],
            "stopZone": {
                "x": self.map.stop_zone.x,
                "y": self.map.stop_zone.y,
                "width": self.map.stop_zone.width,
                "height": self.map.stop_zone.height,
            },
            "checkpoints": [[list(cp.p1), list(cp.p2)] for cp in self.map.checkpoints],
        }

    def _init_generation(self):
        """Initialise la population de voitures IA et pré-calcule le LIDAR t=0."""
        self.agents = []
        self.tick_count = 0
        self.map = IntersectionMap(size=800.0, road_width=140.0)
        for genome in self.population.population.values():
            genome.fitness = 0.0
            net = neat.nn.FeedForwardNetwork.create(genome, self.config)
            car = Car(x=self.start_x, y=self.start_y, angle=self.start_angle)
            car.update_semantic_lidar(self.map, compute_impacts=False)
            self.agents.append(AgentState(car, genome, net))

    def set_paused(self, paused: bool) -> bool:
        """Définit l'état de pause de la simulation."""
        self.paused = bool(paused)
        return self.paused

    def toggle_pause(self) -> bool:
        """Inverse l'état de pause et retourne la nouvelle valeur."""
        self.paused = not self.paused
        return self.paused

    def set_speed_multiplier(self, multiplier: int) -> int:
        """Définit le multiplicateur d'itérations physiques par frame (1, 2, 5, 10)."""
        if multiplier in VALID_SPEED_MULTIPLIERS:
            self.speed_multiplier = multiplier
        else:
            self.speed_multiplier = min(VALID_SPEED_MULTIPLIERS, key=lambda v: abs(v - multiplier))
        return self.speed_multiplier

    def reset_simulation(self):
        """Remet à zéro l'entraînement NEAT à la génération 1."""
        self.all_time_best_fitness = 0.0
        self.all_time_best_checkpoints = 0
        self.all_time_best_laps = 0
        self.history = []
        self.paused = False
        self.map_version += 1
        self._init_population()
        self._init_generation()
        self._cached_map_data = self._build_map_data()

    def step_frame(self):
        """Avance la simulation de `speed_multiplier` ticks si elle n'est pas en pause."""
        if self.paused:
            return
        for _ in range(self.speed_multiplier):
            self.step()

    def step(self):
        """Exécute une itération physique et neuronale synchronisée pour tous les agents."""
        stepped_agents: list[tuple[AgentState, tuple[float, float]]] = []

        # 1. Perception t -> Action neuronale -> Intégration cinématique t -> t+1
        for agent in self.agents:
            if not agent.alive:
                continue

            car = agent.car
            inputs: list[float] = [
                min(1.0, max(0.0, d / car.sensor_range)) for d in car.semantic_distances
            ]
            inputs.append(min(1.0, max(-1.0, car.speed / car.max_speed)))

            outputs = agent.net.activate(inputs)
            prev_pos = (car.x, car.y)
            car.update_physics(outputs[0], outputs[1])
            agent.ticks_alive += 1
            stepped_agents.append((agent, prev_pos))

        # 2. Avancement synchronisé du trafic NPC vers t+1
        self.map.update_traffic(dt=1.0)
        self.tick_count += 1

        num_checkpoints = len(self.map.checkpoints)
        any_alive = False

        # 3. Évaluation collisions, règle STOP, checkpoints multi-tours et mise à jour LIDAR t+1
        for agent, prev_pos in stepped_agents:
            car = agent.car
            curr_pos = (car.x, car.y)

            if car.check_collision(self.map, prev_pos=prev_pos):
                agent.alive = False
                agent.fitness -= 100.0
                continue

            # Règle du panneau STOP
            is_currently_in_stop = self.map.stop_zone.contains(car.x, car.y)
            if is_currently_in_stop:
                agent.was_in_stop_zone = True
                if abs(car.speed) < 0.5:
                    agent.stopped_ticks_in_zone += 1
                    if agent.stopped_ticks_in_zone >= 30 and not agent.stop_bonus_awarded:
                        agent.fitness += 50.0
                        agent.stop_bonus_awarded = True
                        agent.stop_rule_fulfilled = True
                        agent.last_progress_tick = agent.ticks_alive
            elif agent.was_in_stop_zone and not agent.stop_rule_fulfilled:
                agent.fitness -= 200.0
                agent.alive = False
                continue

            # Franchissement séquentiel des checkpoints (boucle fermée multi-tours)
            cp = self.map.checkpoints[agent.checkpoints_passed % num_checkpoints]
            if segment_intersection(prev_pos, curr_pos, cp.p1, cp.p2) is not None:
                agent.checkpoints_passed += 1
                agent.fitness += 100.0
                agent.last_progress_tick = agent.ticks_alive

                if agent.checkpoints_passed % num_checkpoints == 0:
                    agent.laps += 1
                    agent.fitness += 250.0
                    agent.reset_stop_state()

            # Faible incitation à avancer pour amorcer les premières générations
            if car.speed > 0.0:
                agent.fitness += car.speed * 0.01

            # Pénalité de stagnation stricte (300 ticks sans progrès)
            if agent.ticks_alive - agent.last_progress_tick > 300:
                agent.alive = False
                agent.fitness -= 50.0
                continue

            # Capteurs t+1 synchronisés avec la nouvelle position et le nouveau trafic
            car.update_semantic_lidar(self.map, compute_impacts=False)
            any_alive = True

            self.all_time_best_fitness = max(self.all_time_best_fitness, agent.fitness)
            self.all_time_best_checkpoints = max(self.all_time_best_checkpoints, agent.checkpoints_passed)
            self.all_time_best_laps = max(self.all_time_best_laps, agent.laps)

        if not stepped_agents or not any_alive:
            self.next_generation()

    def next_generation(self):
        """Archive les métriques puis fait évoluer la population via NEAT."""
        best_agent: AgentState | None = None
        max_fitness = -float("inf")
        total_fitness = 0.0
        max_checkpoints = 0
        max_laps = 0

        for agent in self.agents:
            agent.genome.fitness = agent.fitness
            total_fitness += agent.fitness
            max_checkpoints = max(max_checkpoints, agent.checkpoints_passed)
            max_laps = max(max_laps, agent.laps)
            if agent.fitness > max_fitness:
                max_fitness = agent.fitness
                best_agent = agent

        if self.agents:
            avg_fitness = total_fitness / len(self.agents)
            species_count = len(self.population.species.species)
            self.all_time_best_fitness = max(self.all_time_best_fitness, max_fitness)
            self.all_time_best_checkpoints = max(self.all_time_best_checkpoints, max_checkpoints)
            self.all_time_best_laps = max(self.all_time_best_laps, max_laps)

            self.history.append({
                "generation": self.generation,
                "bestFitness": round(max_fitness, 1),
                "avgFitness": round(avg_fitness, 1),
                "maxCheckpoints": max_checkpoints,
                "maxLaps": max_laps,
                "speciesCount": species_count,
            })
            if len(self.history) > MAX_HISTORY_LEN:
                self.history = self.history[-MAX_HISTORY_LEN:]

        if best_agent is not None:
            self.population.reporters.post_evaluate(
                self.config,
                self.population.population,
                self.population.species,
                best_agent.genome,
            )
            if (
                self.population.best_genome is None
                or best_agent.fitness > self.population.best_genome.fitness
            ):
                self.population.best_genome = best_agent.genome

        self.population.population = self.population.reproduction.reproduce(
            self.config,
            self.population.species,
            self.config.pop_size,
            self.generation,
        )
        self.population.species.speciate(self.config, self.population.population, self.generation)
        self.population.reporters.end_generation(
            self.config, self.population.population, self.population.species
        )

        self.generation += 1
        self.population.reporters.start_generation(self.generation)
        self._init_generation()

    def force_next_generation(self):
        """Force l'interruption immédiate et la reproduction pour la génération suivante."""
        for agent in self.agents:
            agent.alive = False
        self.next_generation()

    def get_state(self, include_map: bool = True) -> dict[str, Any]:
        """
        Retourne l'état JSON sérialisable pour le frontend :
        - Métriques d'entraînement (génération, espèces, historique, records)
        - Véhicules NPC, meilleure voiture IA (avec impacts LIDAR frais), essaim fantôme
        - Données cartographiques complètes si `include_map=True`
        """
        alive_agents = [a for a in self.agents if a.alive]
        alive_count = len(alive_agents)
        target_pool = alive_agents if alive_agents else self.agents

        traffic_data = [
            {
                "x": round(tc.x, 2),
                "y": round(tc.y, 2),
                "angle": round(tc.angle, 3),
                "speed": round(tc.speed, 2),
                "width": tc.width,
                "height": tc.height,
            }
            for tc in self.map.traffic_cars
        ]

        if target_pool:
            best_agent = max(target_pool, key=lambda a: a.fitness)
            # Recalcul des dictionnaires d'impact uniquement pour la voiture leader affichée
            best_agent.car.update_semantic_lidar(self.map, compute_impacts=True)
            best_car_data: dict[str, Any] | None = {
                "x": round(best_agent.car.x, 2),
                "y": round(best_agent.car.y, 2),
                "angle": round(best_agent.car.angle, 3),
                "speed": round(best_agent.car.speed, 2),
                "braking": best_agent.car.braking,
                "steering": round(best_agent.car.steering, 3),
                "acceleration": round(best_agent.car.acceleration, 3),
                "lidar": [round(d, 2) for d in best_agent.car.semantic_distances],
                "impacts": best_agent.car.semantic_impacts,
                "fitness": round(best_agent.fitness, 1),
                "checkpoints": best_agent.checkpoints_passed,
                "laps": best_agent.laps,
                "stop_rule_fulfilled": best_agent.stop_rule_fulfilled,
                "in_stop_zone": self.map.stop_zone.contains(best_agent.car.x, best_agent.car.y),
                "status": (
                    "STOPPING"
                    if best_agent.car.braking
                    else ("STOP_DONE" if best_agent.stop_rule_fulfilled else "CRUISING")
                ),
            }
            other_cars_data = [
                {
                    "x": round(a.car.x, 2),
                    "y": round(a.car.y, 2),
                    "angle": round(a.car.angle, 3),
                }
                for a in alive_agents
                if a is not best_agent
            ]
        else:
            best_car_data = None
            other_cars_data = []

        state: dict[str, Any] = {
            "generation": self.generation,
            "populationSize": len(self.agents),
            "alive": alive_count,
            "ticks": self.tick_count,
            "paused": self.paused,
            "speedMultiplier": self.speed_multiplier,
            "speciesCount": len(self.population.species.species),
            "allTimeBestFitness": round(self.all_time_best_fitness, 1),
            "allTimeBestCheckpoints": self.all_time_best_checkpoints,
            "allTimeBestLaps": self.all_time_best_laps,
            "history": self.history[-60:],
            "trafficCars": traffic_data,
            "bestCar": best_car_data,
            "otherAiCars": other_cars_data,
            "mapVersion": self.map_version,
        }
        if include_map:
            state["map"] = self._cached_map_data
        return state
