import { Injectable } from '@nestjs/common';
import { BrvmCandle } from './brvm.types';

export interface SmaPoint {
  date: string;
  value: number;
}

@Injectable()
export class BrvmIndicatorsService {
  /**
   * Moyenne mobile simple sur `period` séances. Retourne un point par
   * séance à partir de laquelle il y a assez de données (les `period - 1`
   * premières séances n'ont pas de SMA, elles sont omises plutôt que de
   * renvoyer une valeur partielle/fausse).
   */
  computeSma(candles: BrvmCandle[], period: number): SmaPoint[] {
    if (period <= 0 || candles.length < period) return [];

    const result: SmaPoint[] = [];
    let sum = 0;

    for (let i = 0; i < candles.length; i++) {
      sum += candles[i].close;
      if (i >= period) {
        sum -= candles[i - period].close;
      }
      if (i >= period - 1) {
        result.push({ date: candles[i].date, value: sum / period });
      }
    }

    return result;
  }

  /**
   * RSI (Relative Strength Index) selon la methode de Wilder, la plus
   * standard. Periode habituelle : 14 seances. Formule :
   * RS = moyenne des gains / moyenne des pertes (lissage de Wilder)
   * RSI = 100 - (100 / (1 + RS))
   * Retourne un point par seance a partir de laquelle le calcul est possible
   * (il faut `period` variations, donc `period + 1` cours de cloture).
   */
  computeRsi(candles: BrvmCandle[], period = 14): SmaPoint[] {
    if (period <= 0 || candles.length < period + 1) return [];

    const gains: number[] = [];
    const losses: number[] = [];

    for (let i = 1; i < candles.length; i++) {
      const change = candles[i].close - candles[i - 1].close;
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? -change : 0);
    }

    const result: SmaPoint[] = [];

    // Premiere moyenne : simple moyenne arithmetique sur les `period`
    // premieres variations.
    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

    const pushRsi = (index: number, gain: number, loss: number) => {
      const rs = loss === 0 ? Infinity : gain / loss;
      const rsi = loss === 0 ? 100 : 100 - 100 / (1 + rs);
      // candles[index + 1] car gains/losses[0] correspond a la variation
      // entre candles[0] et candles[1].
      result.push({ date: candles[index + 1].date, value: rsi });
    };

    pushRsi(period - 1, avgGain, avgLoss);

    // Lissage de Wilder pour les seances suivantes : chaque nouvelle moyenne
    // pondere fortement la precedente, plutot que de refaire une moyenne
    // simple sur une fenetre glissante (c'est la definition standard du RSI).
    for (let i = period; i < gains.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
      pushRsi(i, avgGain, avgLoss);
    }

    return result;
  }

  /**
   * Volatilite historique annualisee, calculee sur les `period` dernieres
   * seances (defaut 20 = environ 1 mois de bourse). Ecart-type des
   * rendements quotidiens, annualise par racine(252) (nombre approximatif
   * de seances de bourse par an), exprime en pourcentage.
   * Retourne null si pas assez de donnees.
   */
  computeVolatility(candles: BrvmCandle[], period = 20): number | null {
    if (candles.length < period + 1) return null;

    const recent = candles.slice(-(period + 1));
    const returns: number[] = [];
    for (let i = 1; i < recent.length; i++) {
      if (recent[i - 1].close === 0) continue;
      returns.push((recent[i].close - recent[i - 1].close) / recent[i - 1].close);
    }

    if (returns.length === 0) return null;

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    return stdDev * Math.sqrt(252) * 100;
  }

  /**
   * Drawdown maximal : la plus grosse baisse (en %) entre un sommet et le
   * creux qui a suivi, sur l'historique fourni. Toujours <= 0 (ou null si
   * pas de donnees). C'est une mesure du risque reellement vecu par un
   * investisseur, pas une prediction.
   */
  computeMaxDrawdown(candles: BrvmCandle[]): number | null {
    if (candles.length === 0) return null;

    let peak = candles[0].close;
    let maxDrawdown = 0;

    for (const candle of candles) {
      if (candle.close > peak) peak = candle.close;
      if (peak > 0) {
        const drawdown = (candle.close - peak) / peak;
        if (drawdown < maxDrawdown) maxDrawdown = drawdown;
      }
    }

    return maxDrawdown * 100;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  /**
   * Sous-score Tendance (0-100), pondere 25% dans le KOUNADIA SCORE.
   * Mesure l'ecart relatif entre SMA20 et SMA50, mappe lineairement
   * [-10%, +10%] -> [0, 100]. 50 = SMA20 == SMA50 (aucune tendance nette).
   */
  private scoreTrend(sma20: number, sma50: number): number {
    if (sma50 === 0) return 50;
    const ecart = ((sma20 - sma50) / sma50) * 100;
    return ((this.clamp(ecart, -10, 10) + 10) / 20) * 100;
  }

  /**
   * Sous-score Pression (0-100), pondere 20%. Mesure l'INTENSITE du RSI,
   * symetrique autour de 50 (un RSI a 30 et un RSI a 70 donnent le meme
   * score) : ce sous-score ne mesure jamais une direction, seulement la
   * force du mouvement recent. La direction reelle (hausse/baisse) est
   * toujours calculee et affichee separement.
   */
  private scorePressure(rsi: number): number {
    return this.clamp(Math.abs(rsi - 50) * 2, 0, 100);
  }

  /**
   * Sous-score Momentum (0-100), pondere 20%. Variation du cours sur les
   * 20 dernieres seances, mappee lineairement [-20%, +20%] -> [0, 100].
   */
  private scoreMomentum(momentumPercent: number): number {
    return ((this.clamp(momentumPercent, -20, 20) + 20) / 40) * 100;
  }

  /**
   * Sous-score Stabilite (0-100), pondere 20%. Inverse de la volatilite
   * annualisee : une volatilite faible donne un score eleve. NE SIGNIFIE
   * PAS "meilleure action" - decrit uniquement l'amplitude des variations
   * recentes, pas la qualite du titre.
   */
  private scoreStability(volatilityPercent: number): number {
    return 100 - (this.clamp(volatilityPercent, 0, 80) / 80) * 100;
  }

  /**
   * Fiabilite des donnees (0-100), SEPAREE du KOUNADIA SCORE. Mesure
   * uniquement la confiance qu'on peut avoir dans le calcul (ancienneté de
   * l'historique disponible), pas la performance de l'action. 500 seances
   * (~2 ans de bourse) = fiabilite maximale.
   */
  private scoreDataReliability(nbSeances: number): number {
    return this.clamp((nbSeances / 500) * 100, 0, 100);
  }

  /**
   * KOUNADIA SCORE : synthese deterministe de la configuration technique
   * actuelle d'une action, sur 100 points. Formule documentee et fixe :
   *   Tendance (25%) + Pression (20%) + Momentum (20%) + Stabilite (20%)
   *   + Fiabilite des donnees (15%)
   *
   * IMPORTANT : ce score ne mesure JAMAIS une probabilite de hausse ou de
   * baisse. C'est une description de la configuration technique observee,
   * pas une prediction. La direction (haussiere/baissiere/neutre) est
   * toujours calculee et exposee separement, jamais fusionnee dans ce score.
   */
  computeKounadiaScore(
    candles: BrvmCandle[],
    sma20: SmaPoint[],
    sma50: SmaPoint[],
    rsi14: SmaPoint[],
    volatility20: number | null,
  ): {
    score: number;
    dataReliability: number;
    components: {
      trend: number;
      pressure: number;
      momentum: number;
      stability: number;
    };
    direction: 'haussiere' | 'baissiere' | 'neutre';
    momentum20Percent: number | null;
  } | null {
    if (sma20.length === 0 || sma50.length === 0 || rsi14.length === 0 || volatility20 === null) {
      return null;
    }

    const lastSma20 = sma20[sma20.length - 1].value;
    const lastSma50 = sma50[sma50.length - 1].value;
    const lastRsi = rsi14[rsi14.length - 1].value;

    // Momentum 20 seances : variation du cours entre il y a 20 seances et aujourd'hui.
    let momentum20Percent: number | null = null;
    if (candles.length >= 21) {
      const past = candles[candles.length - 21].close;
      const current = candles[candles.length - 1].close;
      if (past !== 0) momentum20Percent = ((current - past) / past) * 100;
    }

    const trend = this.scoreTrend(lastSma20, lastSma50);
    const pressure = this.scorePressure(lastRsi);
    const momentum = momentum20Percent !== null ? this.scoreMomentum(momentum20Percent) : 50;
    const stability = this.scoreStability(volatility20);
    const dataReliability = this.scoreDataReliability(candles.length);

    const score = trend * 0.25 + pressure * 0.20 + momentum * 0.20 + stability * 0.20;
    // Normalise sur 100 puisque ces 4 composantes pesent 85% avant fiabilite
    // (fiabilite exclue volontairement du score, cf. doc ci-dessus).
    const normalizedScore = (score / 85) * 100;

    // Direction : basee sur la tendance ET le momentum reel, jamais sur le
    // score lui-meme. Seuils volontairement larges pour eviter de qualifier
    // "haussiere"/"baissiere" un mouvement negligeable.
    let direction: 'haussiere' | 'baissiere' | 'neutre' = 'neutre';
    const sma20vs50 = lastSma50 !== 0 ? ((lastSma20 - lastSma50) / lastSma50) * 100 : 0;
    if (sma20vs50 > 0.5 && (momentum20Percent ?? 0) > 0) direction = 'haussiere';
    else if (sma20vs50 < -0.5 && (momentum20Percent ?? 0) < 0) direction = 'baissiere';

    return {
      score: Math.round(normalizedScore * 10) / 10,
      dataReliability: Math.round(dataReliability * 10) / 10,
      components: {
        trend: Math.round(trend * 10) / 10,
        pressure: Math.round(pressure * 10) / 10,
        momentum: Math.round(momentum * 10) / 10,
        stability: Math.round(stability * 10) / 10,
      },
      direction,
      momentum20Percent: momentum20Percent !== null ? Math.round(momentum20Percent * 100) / 100 : null,
    };
  }
}
