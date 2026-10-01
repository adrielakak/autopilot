import os
import math
import neat
from typing import List, Tuple, Dict, Any, Optional
from physics import IntersectionMap, Car, Checkpoint, segment_intersection, point_distance


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
        self.last_progress_tick = 0

        # Règle du STOP
        self.was_in_stop_zone = False
        self.stopped_ticks_in_zone = 0
        self.stop_rule_fulfilled = False
        self.stop_bonus_awarded = False


class SimulationManager:
    """
    Gestionnaire centralisé de la simulation : synchronise l'environnement physique
    (intersection, trafic NPC, zone STOP) et l'algorithme génétique NEAT à 50 individus.
    """
    def __init__(self, config_path: Optional[str] = None):
        if config_path is None:
            config_path = os.path.join(os.path.dirname(__file__), 'config-feedforward.txt')
        self.config_path = config_path

        self.config = neat.config.Config(
            neat.DefaultGenome,
            neat.DefaultReproduction,
            neat.DefaultSpeciesSet,
            neat.DefaultStagnation,
            self.config_path
        )

        self.population = neat.Population(self.config)
        self.population.add_reporter(neat.StdOutReporter(True))
        self.stats = neat.StatisticsReporter()
        self.population.add_reporter(self.stats)

        self.generation = 1
        self.population.reporters.start_generation(self.generation)

        # Environnement physique (Intersection en croix)
        self.map = IntersectionMap(size=800.0, road_width=140.0)

        # Position initiale de l'IA : Voie Sud montant vers le Nord
        self.start_x = self.map.center + (self.map.road_width / 4.0)  # ~435.0
        self.start_y = 750.0
        self.start_angle = -math.pi / 2.0  # Orientée vers le haut (Nord)

        self.agents: List[AgentState] = []
        self._init_generation()

    def _init_generation(self):
        """Initialise la population de 50 voitures IA pour une nouvelle génération."""
        self.agents = []
        # Réinitialisation de l'environnement physique et du trafic
        self.map = IntersectionMap(size=800.0, road_width=140.0)

        for genome_id, genome in self.population.population.items():
            genome.fitness = 0.0
            net = neat.nn.FeedForwardNetwork.create(genome, self.config)
            car = Car(x=self.start_x, y=self.start_y, angle=self.start_angle)
            self.agents.append(AgentState(car, genome, net))

    def step(self):
        """Avance la physique d'un pas (tick) pour toutes les voitures IA et le trafic."""
        # 1. Mise à jour du trafic NPC
        self.map.update_traffic(dt=1.0)

        all_dead = True

        # 2. Mise à jour de chaque voiture IA
        for agent in self.agents:
            if not agent.alive:
                continue

            all_dead = False
            car = agent.car
            agent.ticks_alive += 1

            # Calcul des 15 distances du LIDAR Sémantique (Murs, NPCs, StopZone)
            car.update_semantic_lidar(self.map)

            # Vérification de collision fatale (Mur ou NPC)
            if car.check_collision(self.map):
                agent.alive = False
                agent.fitness -= 100.0  # Grosse pénalité de collision mortelle
                continue

            # Règle du panneau STOP
            is_currently_in_stop = self.map.stop_zone.contains(car.x, car.y)

            if is_currently_in_stop:
                agent.was_in_stop_zone = True
                # Vélocité très basse (< 0.5)
                if abs(car.speed) < 0.5:
                    agent.stopped_ticks_in_zone += 1
                    # Bonus accordé dès 30 itérations d'arrêt respectées
                    if agent.stopped_ticks_in_zone >= 30 and not agent.stop_bonus_awarded:
                        agent.fitness += 50.0
                        agent.stop_bonus_awarded = True
                        agent.stop_rule_fulfilled = True
            else:
                # La voiture est sortie de la StopZone
                if agent.was_in_stop_zone:
                    if not agent.stop_rule_fulfilled:
                        # Échec critique : sortie du STOP sans s'être arrêté !
                        agent.fitness -= 200.0
                        agent.alive = False
                        continue

            # Préparation des 16 entrées normalisées pour le réseau de neurones
            # 15 distances (normalisées entre 0.0 et 1.0)
            inputs: List[float] = [min(1.0, max(0.0, d / car.sensor_range)) for d in car.semantic_distances]
            # 1 valeur de vélocité actuelle normalisée
            inputs.append(min(1.0, max(-1.0, car.speed / car.max_speed)))

            # Activation du réseau FeedForward
            outputs = agent.net.activate(inputs)
            steering_out = outputs[0]      # [-1, 1]
            acceleration_out = outputs[1]  # [-1, 1]

            prev_pos = (car.x, car.y)

            # Mise à jour de la physique cinématique de la voiture
            car.update_physics(steering_out, acceleration_out)
            current_pos = (car.x, car.y)

            # Vérification des checkpoints franchis le long du trajet
            if agent.checkpoints_passed < len(self.map.checkpoints):
                cp = self.map.checkpoints[agent.checkpoints_passed]
                # Intersection avec la ligne de checkpoint
                if segment_intersection(prev_pos, current_pos, cp.p1, cp.p2) is not None:
                    agent.checkpoints_passed += 1
                    agent.fitness += 10.0  # +10 pts par checkpoint franchi
                    agent.last_progress_tick = agent.ticks_alive

            # Récompense douce pour le mouvement avant maîtrisé
            if car.speed > 0:
                agent.fitness += car.speed * 0.05

            # Pénalité de stagnation : élimination si l'agent n'a pas progressé depuis 250 ticks
            # (sauf s'il est en train de marquer l'arrêt dans la zone STOP)
            if not is_currently_in_stop and (agent.ticks_alive - agent.last_progress_tick > 250):
                agent.alive = False

        # Si toute la population est morte ou stagnante, passage à la génération suivante
        if all_dead:
            self.next_generation()

    def next_generation(self):
        """Transition vers la génération suivante via les algorithmes génétiques NEAT."""
        best_agent: Optional[AgentState] = None
        max_fitness = -float('inf')

        for agent in self.agents:
            agent.genome.fitness = agent.fitness
            if agent.fitness > max_fitness:
                max_fitness = agent.fitness
                best_agent = agent

        # Rapports NEAT
        if best_agent is not None:
            self.population.reporters.post_evaluate(
                self.config, self.population.population, self.population.species, best_agent.genome
            )
            if self.population.best_genome is None or best_agent.fitness > self.population.best_genome.fitness:
                self.population.best_genome = best_agent.genome

        # Reproduction génétique
        self.population.population = self.population.reproduction.reproduce(
            self.config, self.population.species, self.config.pop_size, self.generation
        )
        self.population.species.speciate(self.config, self.population.population, self.generation)
        self.population.reporters.end_generation(self.config, self.population.population, self.population.species)

        self.generation += 1
        self.population.reporters.start_generation(self.generation)
        self._init_generation()

    def force_next_generation(self):
        """Force l'interruption immédiate et la reproduction pour la génération suivante."""
        for agent in self.agents:
            agent.alive = False
        self.next_generation()

    def get_state(self) -> Dict[str, Any]:
        """
        Retourne l'état JSON complet requis par le frontend :
        - Génération, Voitures en vie
        - trafficCars : [{x, y}]
        - bestCar : {x, y, angle, speed, braking, lidar (15 valeurs)}
        - otherAiCars : [{x, y}]
        """
        alive_agents = [a for a in self.agents if a.alive]
        alive_count = len(alive_agents)

        # Déterminer la voiture leader (meilleure fitness parmi les vivantes ou générale)
        target_pool = alive_agents if alive_agents else self.agents
        best_agent = max(target_pool, key=lambda a: a.fitness)

        # Formatage des TrafficCars
        traffic_data = [
            {
                "x": round(tc.x, 2),
                "y": round(tc.y, 2),
                "angle": round(tc.angle, 3),
                "speed": round(tc.speed, 2),
                "width": tc.width,
                "height": tc.height
            }
            for tc in self.map.traffic_cars
        ]

        # Formatage de la meilleure voiture (Télémétrie FSD complète)
        best_car_data = {
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
            "stop_rule_fulfilled": best_agent.stop_rule_fulfilled,
            "in_stop_zone": self.map.stop_zone.contains(best_agent.car.x, best_agent.car.y),
            "status": "STOPPING" if best_agent.car.braking else ("STOP_DONE" if best_agent.stop_rule_fulfilled else "CRUISING")
        }

        # Formatage des autres voitures IA (arrière-plan épuré)
        other_cars_data = [
            {"x": round(a.car.x, 2), "y": round(a.car.y, 2)}
            for a in self.agents
            if a != best_agent and a.alive
        ]

        # Données cartographiques pour affichage graphique de type Tesla FSD
        map_data = {
            "size": self.map.size,
            "roadWidth": self.map.road_width,
            "walls": [[list(w.p1), list(w.p2)] for w in self.map.walls],
            "stopZone": {
                "x": self.map.stop_zone.x,
                "y": self.map.stop_zone.y,
                "width": self.map.stop_zone.width,
                "height": self.map.stop_zone.height
            },
            "checkpoints": [[list(cp.p1), list(cp.p2)] for cp in self.map.checkpoints]
        }

        return {
            "generation": self.generation,
            "alive": alive_count,
            "trafficCars": traffic_data,
            "bestCar": best_car_data,
            "otherAiCars": other_cars_data,
            "map": map_data
        }

