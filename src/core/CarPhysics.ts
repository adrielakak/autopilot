export class CarPhysics {
  x: number = 0;
  y: number = 0; // In our 3D world, this will map to Z
  width: number = 2;
  length: number = 4;

  speed: number = 0;
  acceleration: number = 0.2;
  maxSpeed: number = 1.5;
  friction: number = 0.05;
  
  angle: number = 0; // Heading
  steeringAngle: number = 0;
  maxSteeringAngle: number = 0.05;

  // Controls state
  controls = {
    forward: false,
    reverse: false,
    left: false,
    right: false,
  };

  // State flags for animations
  isBraking: boolean = false;
  indicatorLeft: boolean = false;
  indicatorRight: boolean = false;

  constructor(x: number, y: number, angle: number = 0) {
    this.x = x;
    this.y = y;
    this.angle = angle;
  }

  reset(x: number, y: number, angle: number = 0) {
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.speed = 0;
    this.steeringAngle = 0;
    this.isBraking = false;
    this.controls.forward = false;
    this.controls.reverse = false;
    this.controls.left = false;
    this.controls.right = false;
  }

  update() {
    this.move();
  }

  private move() {
    // 1. Acceleration & Braking
    if (this.controls.forward) {
      this.speed += this.acceleration;
      this.isBraking = false;
    } else if (this.controls.reverse) {
      this.speed -= this.acceleration;
      this.isBraking = true; // Simple brake check
    } else {
      this.isBraking = false;
    }

    // Speed caps
    if (this.speed > this.maxSpeed) {
      this.speed = this.maxSpeed;
    }
    if (this.speed < -this.maxSpeed / 2) {
      this.speed = -this.maxSpeed / 2; // reverse is slower
    }

    // Friction
    if (this.speed > 0) {
      this.speed -= this.friction;
    }
    if (this.speed < 0) {
      this.speed += this.friction;
    }
    if (Math.abs(this.speed) < this.friction) {
      this.speed = 0;
    }

    // 2. Steering
    this.indicatorLeft = this.controls.left;
    this.indicatorRight = this.controls.right;

    if (this.speed !== 0) {
      const flip = this.speed > 0 ? 1 : -1;
      
      // Target steering angle (balanced)
      let targetSteering = 0;
      if (this.controls.left && !this.controls.right) {
        targetSteering = this.maxSteeringAngle;
      } else if (this.controls.right && !this.controls.left) {
        targetSteering = -this.maxSteeringAngle;
      }

      // Smooth steering logic
      this.steeringAngle += (targetSteering - this.steeringAngle) * 0.2;
      
      // Apply steering to heading
      this.angle += this.steeringAngle * flip * (Math.abs(this.speed) / this.maxSpeed);
    } else {
      // If stopped, recenter wheels slowly
      this.steeringAngle *= 0.8;
    }

    // 3. Position Update (using basic trig)
    this.x -= Math.sin(this.angle) * this.speed;
    this.y -= Math.cos(this.angle) * this.speed;
  }
}
