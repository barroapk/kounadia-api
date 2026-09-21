import { Injectable, Logger } from '@nestjs/common';
import { OrderedLogitParams, OrderedLogitPredictionExplained, OutcomeRecord } from './ordered-logit.types';

@Injectable()
export class OrderedLogitService {
  private readonly logger = new Logger(OrderedLogitService.name);

  /**
   * ordered_logit_v1 - Modele figé, valide sur snapshot du 20 septembre 2026 :
   *   DEV (n=2196)  : Brier=0.5930 LogLoss=0.9945 RPS=0.2018 (bat Elo v1 sur les 3)
   *   TEST (n=993)  : Brier=0.5951 LogLoss=0.9988 RPS=0.2033
   *                   (bat Elo v1 sur Brier/LogLoss, legerement moins bon sur RPS)
   *
   * Modele : P(away) = sigmoid(theta1 - beta*eloDiff)
   *          P(away+draw) = sigmoid(theta2 - beta*eloDiff)
   *          eloDiff = (EloHome - EloAway) / 400
   *
   * Reparametrisation pour garantir theta1 < theta2 structurellement :
   *   delta = exp(logDelta) > 0 toujours
   *   theta1 = mu - delta, theta2 = mu + delta
   *
   * Optimisation : BFGS (backtracking line search), gradient analytique
   * verifie par differences finies. Audit complet effectue avant adoption :
   * 45/45 tests de robustesse synthetiques, non-regression FD vs analytique,
   * verification des cas limites de convergence.
   *
   * TEST CONSOMME : ce jeu de 993 matchs ne doit plus jamais servir a
   * choisir ou ajuster un parametre. Toute nouvelle variante necessite un
   * nouveau snapshot date avec un nouveau test vierge.
   */
  static readonly MODEL_VERSION = 'ordered_logit_v1';
  private readonly MIN_PROB = 1e-9;

  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }

  private logLikelihood(data: OutcomeRecord[], params: [number, number, number]): number {
    const [beta, mu, logDelta] = params;
    const delta = Math.exp(logDelta);
    const theta1 = mu - delta;
    const theta2 = mu + delta;
    let ll = 0;
    for (const d of data) {
      const z = beta * d.eloDiff;
      const pAway = this.sigmoid(theta1 - z);
      const pAwayOrDraw = this.sigmoid(theta2 - z);
      const pHome = 1 - pAwayOrDraw;
      const pDraw = pAwayOrDraw - pAway;
      const p = d.outcome === 'away' ? pAway : d.outcome === 'draw' ? pDraw : pHome;
      ll += Math.log(Math.max(p, this.MIN_PROB));
    }
    return ll;
  }

  /**
   * Gradient analytique, verifie par differences finies lors de l'audit
   * (ecarts < 0.002 sur tous les points testes). Ne jamais modifier sans
   * repeter cette verification.
   */
  private analyticalGradient(data: OutcomeRecord[], params: [number, number, number]): [number, number, number] {
    const [beta, mu, logDelta] = params;
    const delta = Math.exp(logDelta);
    const theta1 = mu - delta;
    const theta2 = mu + delta;
    let gBeta = 0;
    let gTheta1 = 0;
    let gTheta2 = 0;

    for (const d of data) {
      const z = beta * d.eloDiff;
      const s1 = this.sigmoid(theta1 - z);
      const s2 = this.sigmoid(theta2 - z);
      const ds1 = s1 * (1 - s1);
      const ds2 = s2 * (1 - s2);

      if (d.outcome === 'away') {
        const p = Math.max(s1, this.MIN_PROB);
        gTheta1 += ds1 / p;
        gBeta += (-d.eloDiff * ds1) / p;
      } else if (d.outcome === 'home') {
        const p = Math.max(1 - s2, this.MIN_PROB);
        gTheta2 += -ds2 / p;
        gBeta += (d.eloDiff * ds2) / p;
      } else {
        const p = Math.max(s2 - s1, this.MIN_PROB);
        gTheta1 += -ds1 / p;
        gTheta2 += ds2 / p;
        gBeta += (-d.eloDiff * ds2 + d.eloDiff * ds1) / p;
      }
    }

    const gMu = gTheta1 + gTheta2;
    const gLogDelta = delta * (gTheta2 - gTheta1);
    return [gBeta / data.length, gMu / data.length, gLogDelta / data.length];
  }

  // Petites operations vectorielles/matricielles 3x3 pour BFGS.
  private matVec(M: number[][], v: number[]): number[] {
    return M.map((row) => row.reduce((s, x, i) => s + x * v[i], 0));
  }
  private vecSub(a: number[], b: number[]): number[] {
    return a.map((x, i) => x - b[i]);
  }
  private vecAdd(a: number[], b: number[]): number[] {
    return a.map((x, i) => x + b[i]);
  }
  private vecScale(a: number[], s: number): number[] {
    return a.map((x) => x * s);
  }
  private dot(a: number[], b: number[]): number {
    return a.reduce((s, x, i) => s + x * b[i], 0);
  }
  private outer(a: number[], b: number[]): number[][] {
    return a.map((x) => b.map((y) => x * y));
  }
  private matAdd(A: number[][], B: number[][]): number[][] {
    return A.map((row, i) => row.map((x, j) => x + B[i][j]));
  }
  private matScale(A: number[][], s: number): number[][] {
    return A.map((row) => row.map((x) => x * s));
  }
  private matMul(A: number[][], B: number[][]): number[][] {
    const n = A.length;
    const m = B[0].length;
    const k = B.length;
    const C = Array.from({ length: n }, () => Array(m).fill(0));
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) for (let l = 0; l < k; l++) C[i][j] += A[i][l] * B[l][j];
    return C;
  }

  /**
   * Ajustement par BFGS (formulation standard de minimisation de -LL).
   * Warm start recommande (params precedents comme point de depart) pour
   * un usage walk-forward - convergence en 10-20 iterations typiquement
   * plutot que des milliers avec un gradient ascent simple (audit de
   * cette session : le gradient ascent naif etait ~1000x plus lent).
   */
  fit(
    data: OutcomeRecord[],
    warmStart: OrderedLogitParams | null,
    options: { maxIter?: number; tolGradient?: number } = {},
  ): OrderedLogitParams & { converged: boolean; iterUsed: number } {
    const maxIter = options.maxIter ?? 100;
    const tolGradient = options.tolGradient ?? 1e-6;

    let params: [number, number, number] = warmStart
      ? [warmStart.beta, warmStart.mu, warmStart.logDelta]
      : [0.5, 0.0, Math.log(0.3)];

    let H: number[][] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    let grad = this.analyticalGradient(data, params).map((g) => -g) as [number, number, number];
    let iterUsed = 0;
    let converged = false;

    for (let iter = 0; iter < maxIter; iter++) {
      iterUsed = iter + 1;
      const gradNorm = Math.sqrt(this.dot(grad, grad));
      if (gradNorm < tolGradient) {
        converged = true;
        break;
      }

      const direction = this.vecScale(this.matVec(H, grad), -1);
      let step = 1.0;
      const currentF = -this.logLikelihood(data, params);
      let newParams: number[] = params;
      let newF = currentF;
      let lsAttempts = 0;

      while (lsAttempts < 30) {
        newParams = this.vecAdd(params, this.vecScale(direction, step));
        newF = -this.logLikelihood(data, newParams as [number, number, number]);
        if (newF < currentF) break;
        step *= 0.5;
        lsAttempts++;
      }
      if (lsAttempts >= 30) break;

      const newGrad = this.analyticalGradient(data, newParams as [number, number, number]).map((g) => -g);
      const s = this.vecSub(newParams, params);
      const y = this.vecSub(newGrad, grad);
      const sy = this.dot(s, y);

      if (sy > 1e-12) {
        const rho = 1 / sy;
        const I = [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ];
        const termLeft = this.matAdd(I, this.matScale(this.outer(s, y), -rho));
        const termRight = this.matAdd(I, this.matScale(this.outer(y, s), -rho));
        H = this.matAdd(this.matMul(termLeft, this.matMul(H, termRight)), this.matScale(this.outer(s, s), rho));
      }

      params = newParams as [number, number, number];
      grad = newGrad as [number, number, number];
    }

    return { beta: params[0], mu: params[1], logDelta: params[2], converged, iterUsed };
  }

  /**
   * Prediction traçable pour un match, a partir de parametres deja ajustes.
   */
  predict(
    homeTeam: string,
    awayTeam: string,
    eloDiff: number,
    fitParams: OrderedLogitParams,
  ): OrderedLogitPredictionExplained {
    const delta = Math.exp(fitParams.logDelta);
    const theta1 = fitParams.mu - delta;
    const theta2 = fitParams.mu + delta;
    const z = fitParams.beta * eloDiff;
    const pAway = this.sigmoid(theta1 - z);
    const pAwayOrDraw = this.sigmoid(theta2 - z);
    const pHome = 1 - pAwayOrDraw;
    const pDraw = pAwayOrDraw - pAway;

    return {
      modelVersion: OrderedLogitService.MODEL_VERSION,
      homeTeam,
      awayTeam,
      eloDiff: Math.round(eloDiff * 1000) / 1000,
      beta: Math.round(fitParams.beta * 1000) / 1000,
      theta1: Math.round(theta1 * 1000) / 1000,
      theta2: Math.round(theta2 * 1000) / 1000,
      probabilities: {
        home: Math.round(pHome * 1000) / 1000,
        draw: Math.round(pDraw * 1000) / 1000,
        away: Math.round(pAway * 1000) / 1000,
      },
    };
  }
}
