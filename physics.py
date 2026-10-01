import math
from typing import List, Tuple, Optional, Dict, Any

Point = Tuple[float, float]
Segment = Tuple[Point, Point]


def segment_intersection(p0: Point, p1: Point, p2: Point, p3: Point) -> Optional[Point]:
    """
    Calcule l'intersection exacte entre deux segments 2D [p0, p1] et [p2, p3].
    Utilise les produits en croix vectoriels 2D (analytique, 0 allocation mémoire inutile).
    Retourne (x, y) s'il y a intersection, sinon None.
    """
    s1_x = p1[0] - p0[0]
    s1_y = p1[1] - p0[1]
    s2_x = p3[0] - p2[0]
    s2_y = p3[1] - p2[1]

    denom = s1_x * s2_y - s1_y * s2_x
    if abs(denom) < 1e-9:
        return None  # Segments parallèles ou colinéaires

    dx = p0[0] - p2[0]
    dy = p0[1] - p2[1]

    s = (s1_x * dy - s1_y * dx) / denom
    t = (s2_x * dy - s2_y * dx) / denom

    if 0.0 <= s <= 1.0 and 0.0 <= t <= 1.0:
        return (p0[0] + t * s1_x, p0[1] + t * s1_y)

    return None


def point_distance(p1: Point, p2: Point) -> float:
    """Distance euclidienne entre deux points 2D."""
    return math.hypot(p2[0] - p1[0], p2[1] - p1[1])


class Wall:
    """Représente un mur statique sous forme de segment de droite intraversable."""
    def __init__(self, p1: Point, p2: Point):
        self.p1 = p1
        self.p2 = p2


class StopZone:
    """
    Rectangle de signalisation STOP situé sur la chaussée avant l'intersection.
    Orientation et boîte englobante définies par ses 4 sommets et ses 4 segments.
    """
    def __init__(self, x: float, y: float, width: float, height: float):
        self.x = x
        self.y = y
        self.width = width
        self.height = height

        # Coordonnées des 4 sommets
        self.p1 = (x, y)
        self.p2 = (x + width, y)
        self.p3 = (x + width, y + height)
        self.p4 = (x, y + height)

        # 4 segments de bordure pour les intersections LIDAR
        self.segments: List[Segment] = [
            (self.p1, self.p2),
            (self.p2, self.p3),
            (self.p3, self.p4),
            (self.p4, self.p1)
        ]

    def contains(self, x: float, y: float) -> bool:
        """Vérifie si le point (x, y) se trouve à l'intérieur du rectangle STOP."""
        return (self.x <= x <= self.x + self.width) and (self.y <= y <= self.y + self.height)


class TrafficCar:
    """
    Véhicule NPC se déplaçant à vitesse constante en ligne droite à travers l'intersection.
    Représente un obstacle dynamique mortel pour l'IA.
    """
    def __init__(self, start_x: float, start_y: float, angle: float, speed: float, 
                 reset_dist: float = 900.0, width: float = 36.0, height: float = 18.0):
        self.initial_x = start_x
        self.initial_y = start_y
        self.x = start_x
        self.y = start_y
        self.angle = angle
        self.speed = speed
        self.reset_dist = reset_dist
        self.width = width   # Longueur du véhicule
        self.height = height # Largeur du véhicule

    def update(self, dt: float = 1.0):
        """Met à jour la position du NPC en ligne droite."""
        self.x += math.cos(self.angle) * self.speed * dt
        self.y += math.sin(self.angle) * self.speed * dt

        # Réapparition en boucle continue lorsqu'il sort de la carte
        dist_from_start = point_distance((self.initial_x, self.initial_y), (self.x, self.y))
        if dist_from_start > self.reset_dist:
            self.x = self.initial_x
            self.y = self.initial_y

    def get_segments(self) -> List[Segment]:
        """
        Retourne les 4 segments de la boîte englobante orientée (OBB) du véhicule NPC.
        """
        cos_a = math.cos(self.angle)
        sin_a = math.sin(self.angle)

        hw = self.width / 2.0
        hh = self.height / 2.0

        # Les 4 coins relatifs tournés
        corners = [
            (self.x + cos_a * (-hw) - sin_a * (-hh), self.y + sin_a * (-hw) + cos_a * (-hh)),
            (self.x + cos_a * (hw) - sin_a * (-hh),  self.y + sin_a * (hw) + cos_a * (-hh)),
            (self.x + cos_a * (hw) - sin_a * (hh),   self.y + sin_a * (hw) + cos_a * (hh)),
            (self.x + cos_a * (-hw) - sin_a * (hh),  self.y + sin_a * (-hw) + cos_a * (hh))
        ]

        return [
            (corners[0], corners[1]),
            (corners[1], corners[2]),
            (corners[2], corners[3]),
            (corners[3], corners[0])
        ]


class Checkpoint:
    """Ligne de contrôle invisible récompensant la progression le long du parcours."""
    def __init__(self, p1: Point, p2: Point):
        self.p1 = p1
        self.p2 = p2


class IntersectionMap:
    """
    Environnement complet en 2D : Circuit fermé (boucle) avec une zone STOP et du trafic.
    """
    def __init__(self, size: float = 800.0, road_width: float = 140.0):
        self.size = size
        self.road_width = road_width
        self.center = size / 2.0

        self.walls: List[Wall] = [
            # Murs extérieurs (octogone)
            Wall((140.0, 40.0), (660.0, 40.0)),   # Haut
            Wall((660.0, 40.0), (760.0, 140.0)),  # Diagonale Haut-Droit
            Wall((760.0, 140.0), (760.0, 660.0)), # Droit
            Wall((760.0, 660.0), (660.0, 760.0)), # Diagonale Bas-Droit
            Wall((660.0, 760.0), (140.0, 760.0)), # Bas
            Wall((140.0, 760.0), (40.0, 660.0)),  # Diagonale Bas-Gauche
            Wall((40.0, 660.0), (40.0, 140.0)),   # Gauche
            Wall((40.0, 140.0), (140.0, 40.0)),   # Diagonale Haut-Gauche

            # Murs intérieurs (octogone central)
            Wall((240.0, 180.0), (560.0, 180.0)), # Haut
            Wall((560.0, 180.0), (620.0, 240.0)), # Diagonale Haut-Droit
            Wall((620.0, 240.0), (620.0, 560.0)), # Droit
            Wall((620.0, 560.0), (560.0, 620.0)), # Diagonale Bas-Droit
            Wall((560.0, 620.0), (240.0, 620.0)), # Bas
            Wall((240.0, 620.0), (180.0, 560.0)), # Diagonale Bas-Gauche
            Wall((180.0, 560.0), (180.0, 240.0)), # Gauche
            Wall((180.0, 240.0), (240.0, 180.0)), # Diagonale Haut-Gauche
        ]

        self.wall_segments: List[Segment] = [(w.p1, w.p2) for w in self.walls]

        # StopZone sur la ligne droite du haut (véhicules allant vers la droite)
        self.stop_zone = StopZone(x=300.0, y=40.0, width=60.0, height=140.0)

        # Checkpoints jalonnant le circuit complet (sens horaire, départ à gauche)
        self.checkpoints: List[Checkpoint] = [
            # Départ sur la gauche (vers le haut)
            Checkpoint((40.0, 300.0), (180.0, 300.0)),
            Checkpoint((40.0, 180.0), (180.0, 180.0)),
            # Haut (vers la droite)
            Checkpoint((240.0, 40.0), (240.0, 180.0)),
            Checkpoint((400.0, 40.0), (400.0, 180.0)), # Après le STOP
            Checkpoint((560.0, 40.0), (560.0, 180.0)),
            # Droite (vers le bas)
            Checkpoint((620.0, 240.0), (760.0, 240.0)),
            Checkpoint((620.0, 400.0), (760.0, 400.0)),
            Checkpoint((620.0, 560.0), (760.0, 560.0)),
            # Bas (vers la gauche)
            Checkpoint((560.0, 620.0), (560.0, 760.0)),
            Checkpoint((400.0, 620.0), (400.0, 760.0)),
            Checkpoint((240.0, 620.0), (240.0, 760.0)),
            # Retour à gauche
            Checkpoint((40.0, 560.0), (180.0, 560.0)),
            Checkpoint((40.0, 450.0), (180.0, 450.0))
        ]

        # Trafic transversal : "Piétons" ou véhicules traversant la ligne droite du haut
        self.traffic_cars: List[TrafficCar] = [
            TrafficCar(start_x=380.0, start_y=-60.0, angle=math.pi/2, speed=2.5, reset_dist=400.0),
            TrafficCar(start_x=450.0, start_y=300.0, angle=-math.pi/2, speed=2.0, reset_dist=400.0)
        ]

    def update_traffic(self, dt: float = 1.0):
        """Met à jour l'ensemble des véhicules NPC."""
        for car in self.traffic_cars:
            car.update(dt)


class Car:
    """
    Véhicule IA autonome équipé d'un LIDAR sémantique 3-voies.
    Gère la cinématique réaliste (accélération, friction, braquage dépendant de la vitesse).
    """
    def __init__(self, x: float, y: float, angle: float = -math.pi / 2.0):
        self.x = x
        self.y = y
        self.angle = angle
        self.speed = 0.0
        self.acceleration = 0.0
        self.steering = 0.0
        self.braking = False

        # Constantes physiques
        self.max_speed = 7.0
        self.max_reverse_speed = -2.0
        self.friction = 0.95
        self.accel_power = 0.4
        self.brake_power = 0.6
        self.steering_power = 0.08
        self.collision_radius = 12.0

        # Paramètres LIDAR Sémantique (5 rayons à -90°, -45°, 0°, +45°, +90°)
        self.sensor_angles = [-math.pi / 2.0, -math.pi / 4.0, 0.0, math.pi / 4.0, math.pi / 2.0]
        self.sensor_range = 150.0  # Portée maximale (150m ou px)

        # 15 distances réelles : 5 rayons x [distance_mur, distance_npc, distance_stop]
        self.semantic_distances: List[float] = [self.sensor_range] * 15
        # Points d'impacts pour visualisation
        self.semantic_impacts: List[Dict[str, Any]] = []

    def update_physics(self, steering_input: float, accel_input: float):
        """
        Met à jour la position et la vélocité selon les sorties du réseau de neurones.
        :param steering_input: Valeur entre -1.0 (gauche) et 1.0 (droite)
        :param accel_input: Valeur entre -1.0 (frein) et 1.0 (accélération)
        """
        self.steering = max(-1.0, min(1.0, steering_input))
        self.acceleration = max(-1.0, min(1.0, accel_input))

        # Freinage actif
        if self.acceleration < -0.05:
            self.braking = True
            self.speed += self.acceleration * self.brake_power
        else:
            self.braking = False
            self.speed += self.acceleration * self.accel_power

        # Friction naturelle
        self.speed *= self.friction

        # Bornage de la vitesse
        self.speed = max(self.max_reverse_speed, min(self.max_speed, self.speed))
        if abs(self.speed) < 0.02:
            self.speed = 0.0

        # Braquage uniquement si la voiture est en mouvement (effet cinématique)
        if abs(self.speed) > 0.1:
            direction = 1.0 if self.speed >= 0 else -1.0
            self.angle += self.steering * self.steering_power * direction

        # Mise à jour des coordonnées
        self.x += math.cos(self.angle) * self.speed
        self.y += math.sin(self.angle) * self.speed

    def update_semantic_lidar(self, env: IntersectionMap):
        """
        Calcule les 15 distances du LIDAR Sémantique (3 par rayon) :
        - Mur le plus proche
        - NPC le plus proche
        - StopZone la plus proche
        Si rien n'est touché, la distance est self.sensor_range.
        """
        car_pos = (self.x, self.y)
        npc_segments: List[Segment] = []
        for npc in env.traffic_cars:
            npc_segments.extend(npc.get_segments())

        stop_segments = env.stop_zone.segments

        new_distances: List[float] = []
        new_impacts: List[Dict[str, Any]] = []

        for offset in self.sensor_angles:
            ray_angle = self.angle + offset
            ray_end = (
                self.x + math.cos(ray_angle) * self.sensor_range,
                self.y + math.sin(ray_angle) * self.sensor_range
            )

            min_dist_wall = self.sensor_range
            wall_hit = ray_end

            min_dist_npc = self.sensor_range
            npc_hit = ray_end

            min_dist_stop = self.sensor_range
            stop_hit = ray_end

            # 1. Distance Murs
            for p1, p2 in env.wall_segments:
                hit = segment_intersection(car_pos, ray_end, p1, p2)
                if hit:
                    d = point_distance(car_pos, hit)
                    if d < min_dist_wall:
                        min_dist_wall = d
                        wall_hit = hit

            # 2. Distance NPCs
            for p1, p2 in npc_segments:
                hit = segment_intersection(car_pos, ray_end, p1, p2)
                if hit:
                    d = point_distance(car_pos, hit)
                    if d < min_dist_npc:
                        min_dist_npc = d
                        npc_hit = hit

            # 3. Distance StopZone
            for p1, p2 in stop_segments:
                hit = segment_intersection(car_pos, ray_end, p1, p2)
                if hit:
                    d = point_distance(car_pos, hit)
                    if d < min_dist_stop:
                        min_dist_stop = d
                        stop_hit = hit

            new_distances.extend([min_dist_wall, min_dist_npc, min_dist_stop])
            new_impacts.append({
                "wall": {"x": wall_hit[0], "y": wall_hit[1], "dist": min_dist_wall},
                "npc": {"x": npc_hit[0], "y": npc_hit[1], "dist": min_dist_npc},
                "stop": {"x": stop_hit[0], "y": stop_hit[1], "dist": min_dist_stop}
            })

        self.semantic_distances = new_distances
        self.semantic_impacts = new_impacts

    def check_collision(self, env: IntersectionMap) -> bool:
        """
        Vérifie si la voiture a percuté un mur ou un NPC.
        Retourne True si collision fatale.
        """
        # Vérification par rapport aux distances minimales de sécurité du LIDAR
        # Rayons 0, 3, 6, 9, 12 = Murs ; Rayons 1, 4, 7, 10, 13 = NPCs
        for i in range(5):
            d_wall = self.semantic_distances[i * 3]
            d_npc = self.semantic_distances[i * 3 + 1]
            if d_wall < self.collision_radius or d_npc < self.collision_radius:
                return True

        # Contrôle direct de proximité avec les centres des NPCs
        for npc in env.traffic_cars:
            if point_distance((self.x, self.y), (npc.x, npc.y)) < (self.collision_radius + npc.height):
                return True

        return False
