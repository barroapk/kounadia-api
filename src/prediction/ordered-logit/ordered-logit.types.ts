export interface OrderedLogitParams {
  beta: number;
  mu: number;
  logDelta: number;
}

export interface OrderedLogitPredictionExplained {
  modelVersion: string;
  homeTeam: string;
  awayTeam: string;
  eloDiff: number;
  beta: number;
  theta1: number;
  theta2: number;
  probabilities: {
    home: number;
    draw: number;
    away: number;
  };
}

export interface OutcomeRecord {
  eloDiff: number;
  outcome: 'home' | 'draw' | 'away';
}
