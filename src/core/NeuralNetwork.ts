export class Level {
  inputs: number[];
  outputs: number[];
  biases: number[];
  weights: number[][];

  constructor(inputCount: number, outputCount: number) {
    this.inputs = new Array(inputCount).fill(0);
    this.outputs = new Array(outputCount).fill(0);
    this.biases = new Array(outputCount).fill(0);
    
    this.weights = [];
    for (let i = 0; i < inputCount; i++) {
      this.weights[i] = new Array(outputCount).fill(0);
    }
    
    Level.randomize(this);
  }

  static randomize(level: Level) {
    for (let i = 0; i < level.inputs.length; i++) {
      for (let j = 0; j < level.outputs.length; j++) {
        level.weights[i][j] = Math.random() * 2 - 1;
      }
    }
    for (let i = 0; i < level.biases.length; i++) {
      level.biases[i] = Math.random() * 2 - 1;
    }
  }

  static feedForward(givenInputs: number[], level: Level): number[] {
    for (let i = 0; i < level.inputs.length; i++) {
      level.inputs[i] = givenInputs[i];
    }

    for (let i = 0; i < level.outputs.length; i++) {
      let sum = 0;
      for (let j = 0; j < level.inputs.length; j++) {
        sum += level.inputs[j] * level.weights[j][i];
      }
      
      // Activation function (Hyperbolic tangent or simple step)
      // Here we use a step-like function for outputs: if sum > bias -> 1, else 0
      // Actually, standard Math.tanh or ReLU is better. Let's use simple Threshold for now, 
      // or a continuous function if we want smooth steering.
      if (sum > level.biases[i]) {
        level.outputs[i] = 1;
      } else {
        level.outputs[i] = 0;
      }
    }
    return level.outputs;
  }
}

export class NeuralNetwork {
  levels: Level[];

  constructor(neuronCounts: number[]) {
    this.levels = [];
    for (let i = 0; i < neuronCounts.length - 1; i++) {
      this.levels.push(new Level(neuronCounts[i], neuronCounts[i + 1]));
    }
  }

  static feedForward(givenInputs: number[], network: NeuralNetwork): number[] {
    let outputs = Level.feedForward(givenInputs, network.levels[0]);
    for (let i = 1; i < network.levels.length; i++) {
      outputs = Level.feedForward(outputs, network.levels[i]);
    }
    return outputs;
  }

  static mutate(network: NeuralNetwork, amount: number = 0.1) {
    network.levels.forEach((level) => {
      for (let i = 0; i < level.biases.length; i++) {
        level.biases[i] = this.lerp(level.biases[i], Math.random() * 2 - 1, amount);
      }
      for (let i = 0; i < level.weights.length; i++) {
        for (let j = 0; j < level.weights[i].length; j++) {
          level.weights[i][j] = this.lerp(level.weights[i][j], Math.random() * 2 - 1, amount);
        }
      }
    });
  }

  static clone(network: NeuralNetwork): NeuralNetwork {
    const counts = [
      network.levels[0].inputs.length,
      ...network.levels.map(l => l.outputs.length)
    ];
    const newNetwork = new NeuralNetwork(counts);
    for (let l = 0; l < network.levels.length; l++) {
      newNetwork.levels[l].biases = [...network.levels[l].biases];
      newNetwork.levels[l].weights = network.levels[l].weights.map(row => [...row]);
    }
    return newNetwork;
  }

  static lerp(A: number, B: number, t: number) {
    return A + (B - A) * t;
  }
}
