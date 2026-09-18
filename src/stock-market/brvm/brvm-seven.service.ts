import { Injectable } from '@nestjs/common';
import { BrvmCandle } from './brvm.types';
import { BrvmIndicatorsService } from './brvm-indicators.service';

export type SevenDirection =
  | 'haussiere'
  | 'baissiere'
  | 'neutre';

export interface SevenTrendResult {
  score: number;
  direction: SevenDirection;
  sma20: number;
  sma50: number;
  close: number;
  closeVsSma20Percent: number;
  sma20VsSma50Percent: number;
}

export type SevenMomentumDirection =
  | 'positif'
  | 'negatif'
  | 'neutre';

export interface SevenMomentumResult {
  score: number;
  direction: SevenMomentumDirection;
  rsi14: number;
  variation5Percent: number;
  variation20Percent: number;
}
export interface SevenVolumeResult {
  score: number;
  averageVolume20: number;
  currentVolume: number;
  volumeRatio: number;
  activeSessionsRatio: number;
}

export type SevenLiquidityLevel =
  | 'faible'
  | 'moyenne'
  | 'bonne'
  | 'excellente';

export interface SevenLiquidityResult {
  score: number;
  level: SevenLiquidityLevel;
  averageDailyValue20: number;
  averageDailyVolume20: number;
  activeSessionsRatio: number;
  activeSessions: number;
  totalSessions: number;
}

export type SevenRiskLevel =
  | 'faible'
  | 'modere'
  | 'eleve'
  | 'tres_eleve';

export interface SevenVolatilityResult {
  score: number;
  volatility20Percent: number;
  riskLevel: SevenRiskLevel;
  averageAbsoluteMove20Percent: number;
}

export interface SevenStructureResult {
  score: number;
  positiveSessionsRatio: number;
  negativeSessionsRatio: number;
  rangePositionPercent: number;
  directionalConsistency: number;
  quality: 'faible' | 'moyenne' | 'bonne' | 'excellente';
}

export type SevenConfluenceDirection =
  | 'haussiere'
  | 'baissiere'
  | 'neutre';

export interface SevenConfluenceResult {
  score: number;
  direction: SevenConfluenceDirection;
  confidence: number;
  reliability: number;
  components: {
    trend: number;
    momentum: number;
    volume: number;
    liquidity: number;
    volatility: number;
    structure: number;
  };
  agreement: number;
  reading:
    | 'faible'
    | 'neutre'
    | 'a_surveiller'
    | 'interessante'
    | 'forte'
    | 'exceptionnelle';
}


@Injectable()
export class BrvmSevenService {
  constructor(
    private readonly indicators: BrvmIndicatorsService,
  ) {}

  /**
   * CRITÈRE 1/7 — TENDANCE
   *
   * Analyse :
   * - SMA20 vs SMA50
   * - cours actuel vs SMA20
   *
   * Le score décrit la configuration observée.
   * Ce n'est PAS une probabilité de hausse.
   */
  computeTrend(candles: BrvmCandle[]): SevenTrendResult | null {
    if (candles.length < 50) {
      return null;
    }

    const sma20 = this.indicators.computeSma(candles, 20);
    const sma50 = this.indicators.computeSma(candles, 50);

    if (sma20.length === 0 || sma50.length === 0) {
      return null;
    }

    const close = candles[candles.length - 1].close;
    const lastSma20 = sma20[sma20.length - 1].value;
    const lastSma50 = sma50[sma50.length - 1].value;

    if (lastSma20 === 0 || lastSma50 === 0) {
      return null;
    }

    const sma20VsSma50Percent =
      ((lastSma20 - lastSma50) / lastSma50) * 100;

    const closeVsSma20Percent =
      ((close - lastSma20) / lastSma20) * 100;

    // SMA20/SMA50 = 60% du critère.
    const smaComponent =
      ((this.clamp(sma20VsSma50Percent, -10, 10) + 10) / 20) * 100;

    // Position du cours = 40%.
    const closeComponent =
      ((this.clamp(closeVsSma20Percent, -5, 5) + 5) / 10) * 100;

    const score =
      smaComponent * 0.6 +
      closeComponent * 0.4;

    let direction: SevenDirection = 'neutre';

    if (
      sma20VsSma50Percent > 0.5 &&
      closeVsSma20Percent > 0
    ) {
      direction = 'haussiere';
    } else if (
      sma20VsSma50Percent < -0.5 &&
      closeVsSma20Percent < 0
    ) {
      direction = 'baissiere';
    }

    return {
      score: Math.round(score * 10) / 10,
      direction,
      sma20: Math.round(lastSma20 * 100) / 100,
      sma50: Math.round(lastSma50 * 100) / 100,
      close: Math.round(close * 100) / 100,
      closeVsSma20Percent:
        Math.round(closeVsSma20Percent * 100) / 100,
      sma20VsSma50Percent:
        Math.round(sma20VsSma50Percent * 100) / 100,
    };
  }

  /**
   * CRITÈRE 2/7 — MOMENTUM
   *
   * Combine :
   * - RSI 14 : 40%
   * - variation 5 séances : 30%
   * - variation 20 séances : 30%
   *
   * Le score décrit la force du mouvement récent.
   * Il ne représente pas une probabilité de hausse.
   */
  computeMomentum(
    candles: BrvmCandle[],
  ): SevenMomentumResult | null {
    if (candles.length < 21) {
      return null;
    }

    const rsi = this.indicators.computeRsi(candles, 14);

    if (rsi.length === 0) {
      return null;
    }

    const lastRsi = rsi[rsi.length - 1].value;

    const current = candles[candles.length - 1].close;
    const close5 = candles[candles.length - 6].close;
    const close20 = candles[candles.length - 21].close;

    if (close5 === 0 || close20 === 0) {
      return null;
    }

    const variation5Percent =
      ((current - close5) / close5) * 100;

    const variation20Percent =
      ((current - close20) / close20) * 100;

    const rsiComponent =
      this.clamp(lastRsi, 0, 100);

    const variation5Component =
      ((this.clamp(variation5Percent, -10, 10) + 10) / 20) * 100;

    const variation20Component =
      ((this.clamp(variation20Percent, -20, 20) + 20) / 40) * 100;

    const score =
      rsiComponent * 0.4 +
      variation5Component * 0.3 +
      variation20Component * 0.3;

    let direction: SevenMomentumDirection = 'neutre';

    if (
      variation5Percent > 0 &&
      variation20Percent > 0
    ) {
      direction = 'positif';
    } else if (
      variation5Percent < 0 &&
      variation20Percent < 0
    ) {
      direction = 'negatif';
    }

    return {
      score: Math.round(score * 10) / 10,
      direction,
      rsi14: Math.round(lastRsi * 10) / 10,
      variation5Percent:
        Math.round(variation5Percent * 100) / 100,
      variation20Percent:
        Math.round(variation20Percent * 100) / 100,
    };
  }

  /**
   * CRITÈRE 3/7 — VOLUME
   *
   * Mesure l'activité récente du titre :
   * - volume actuel vs moyenne 20 séances : 70%
   * - régularité des séances actives : 30%
   *
   * Le score mesure l'activité observée, pas la direction future du cours.
   */
  computeVolume(
    candles: BrvmCandle[],
  ): SevenVolumeResult | null {
    if (candles.length < 20) {
      return null;
    }

    const recent20 = candles.slice(-20);

    const averageVolume20 =
      recent20.reduce((sum, candle) => sum + candle.volume, 0) /
      recent20.length;

    const currentVolume =
      candles[candles.length - 1].volume;

    const volumeRatio =
      averageVolume20 === 0
        ? 0
        : currentVolume / averageVolume20;

    const activeSessionsRatio =
      (
        recent20.filter((candle) => candle.volume > 0).length /
        recent20.length
      ) * 100;

    // 0x = 0, 3x = 100.
    const volumeActivityScore =
      this.clamp((volumeRatio / 3) * 100, 0, 100);

    const regularityScore =
      this.clamp(activeSessionsRatio, 0, 100);

    const score =
      volumeActivityScore * 0.7 +
      regularityScore * 0.3;

    return {
      score: Math.round(score * 10) / 10,
      averageVolume20: Math.round(averageVolume20),
      currentVolume: Math.round(currentVolume),
      volumeRatio: Math.round(volumeRatio * 100) / 100,
      activeSessionsRatio:
        Math.round(activeSessionsRatio * 10) / 10,
    };
  }

  /**
   * CRITÈRE 4/7 — LIQUIDITÉ
   *
   * La liquidité ne mesure pas simplement le volume.
   *
   * Elle cherche à répondre à une question différente :
   * "Le titre est-il raisonnablement négociable ?"
   *
   * Composantes :
   * - valeur moyenne échangée sur 20 séances : 60%
   * - régularité des séances actives : 40%
   *
   * Une séance active = volume > 0.
   *
   * Le score décrit la liquidité observée.
   * Il ne représente PAS une probabilité de hausse.
   */
  computeLiquidity(
    candles: BrvmCandle[],
  ): SevenLiquidityResult | null {
    if (candles.length < 20) {
      return null;
    }

    const recent20 = candles.slice(-20);

    const averageDailyVolume20 =
      recent20.reduce((sum, candle) => sum + candle.volume, 0) /
      recent20.length;

    const averageDailyValue20 =
      recent20.reduce(
        (sum, candle) => sum + candle.volume * candle.close,
        0,
      ) / recent20.length;

    const activeSessions =
      recent20.filter((candle) => candle.volume > 0).length;

    const totalSessions = recent20.length;

    const activeSessionsRatio =
      (activeSessions / totalSessions) * 100;

    /*
     * Pour éviter qu'un seul titre domine artificiellement le score,
     * la valeur échangée est transformée en échelle logarithmique.
     *
     * 100 000 FCFA/jour ≈ score faible
     * 1 000 000 FCFA/jour ≈ zone moyenne
     * 10 000 000 FCFA/jour ≈ bonne zone
     * 100 000 000 FCFA/jour ≈ excellente zone
     *
     * Cette échelle est volontairement progressive car les valeurs
     * échangées sur la BRVM peuvent être très dispersées.
     */
    const safeValue = Math.max(averageDailyValue20, 1);

    const logValue = Math.log10(safeValue);

    const valueScore =
      this.clamp(((logValue - 5) / 4) * 100, 0, 100);

    const regularityScore =
      this.clamp(activeSessionsRatio, 0, 100);

    const score =
      valueScore * 0.6 +
      regularityScore * 0.4;

    let level: SevenLiquidityLevel;

    if (score < 40) {
      level = 'faible';
    } else if (score < 60) {
      level = 'moyenne';
    } else if (score < 80) {
      level = 'bonne';
    } else {
      level = 'excellente';
    }

    return {
      score: Math.round(score * 10) / 10,
      level,
      averageDailyValue20: Math.round(averageDailyValue20),
      averageDailyVolume20: Math.round(averageDailyVolume20),
      activeSessionsRatio:
        Math.round(activeSessionsRatio * 10) / 10,
      activeSessions,
      totalSessions,
    };
  }

  /**
   * CRITÈRE 5/7 — VOLATILITÉ & RISQUE
   *
   * La volatilité mesure l'amplitude des variations récentes.
   *
   * Elle n'est PAS considérée comme mauvaise par défaut :
   * une volatilité raisonnable peut créer des opportunités de trading.
   *
   * Deux informations sont donc retournées séparément :
   * - score : qualité de la volatilité pour une stratégie active ;
   * - riskLevel : niveau de danger associé à l'amplitude observée.
   *
   * Calcul :
   * - écart-type des rendements quotidiens sur 20 séances ;
   * - annualisation par sqrt(252) ;
   * - moyenne des variations absolues pour contextualiser le mouvement.
   */
  computeVolatility(
    candles: BrvmCandle[],
  ): SevenVolatilityResult | null {
    if (candles.length < 21) {
      return null;
    }

    const recent = candles.slice(-21);

    const returns: number[] = [];
    const absoluteMoves: number[] = [];

    for (let i = 1; i < recent.length; i++) {
      const previous = recent[i - 1].close;
      const current = recent[i].close;

      if (previous <= 0) {
        continue;
      }

      const dailyReturn =
        ((current - previous) / previous) * 100;

      returns.push(dailyReturn);
      absoluteMoves.push(Math.abs(dailyReturn));
    }

    if (returns.length === 0) {
      return null;
    }

    const mean =
      returns.reduce((sum, value) => sum + value, 0) /
      returns.length;

    const variance =
      returns.reduce(
        (sum, value) => sum + (value - mean) ** 2,
        0,
      ) / returns.length;

    const dailyStdDev = Math.sqrt(variance);

    const volatility20Percent =
      dailyStdDev * Math.sqrt(252);

    const averageAbsoluteMove20Percent =
      absoluteMoves.reduce((sum, value) => sum + value, 0) /
      absoluteMoves.length;

    /*
     * Zone recherchée pour le trading :
     *
     * < 5%  annualisé  → mouvement très faible
     * 5-15%             → faible à modéré
     * 15-30%            → zone intéressante
     * 30-50%            → forte
     * > 50%             → très forte
     *
     * Le score privilégie une volatilité intermédiaire/active
     * plutôt qu'une volatilité maximale.
     */
    let score: number;

    if (volatility20Percent < 5) {
      score = 40 + (volatility20Percent / 5) * 20;
    } else if (volatility20Percent < 15) {
      score = 60 + ((volatility20Percent - 5) / 10) * 20;
    } else if (volatility20Percent <= 30) {
      score = 80 + ((volatility20Percent - 15) / 15) * 20;
    } else {
      score =
        100 -
        ((volatility20Percent - 30) / 40) * 35;
    }

    score = this.clamp(score, 0, 100);

    let riskLevel: SevenRiskLevel;

    if (volatility20Percent < 10) {
      riskLevel = 'faible';
    } else if (volatility20Percent < 25) {
      riskLevel = 'modere';
    } else if (volatility20Percent < 45) {
      riskLevel = 'eleve';
    } else {
      riskLevel = 'tres_eleve';
    }

    return {
      score: Math.round(score * 10) / 10,
      volatility20Percent:
        Math.round(volatility20Percent * 100) / 100,
      riskLevel,
      averageAbsoluteMove20Percent:
        Math.round(averageAbsoluteMove20Percent * 100) / 100,
    };
  }

  /**
   * CRITÈRE 6/7 — STRUCTURE DU MOUVEMENT
   *
   * Cherche à savoir si le mouvement récent est cohérent ou désordonné.
   *
   * Composantes :
   * - séances positives/négatives ;
   * - position du cours dans sa fourchette 20 séances ;
   * - cohérence directionnelle des variations.
   *
   * Ce critère ne prédit pas le prochain mouvement.
   * Il mesure uniquement la qualité de la structure actuellement observée.
   */
  computeStructure(
    candles: BrvmCandle[],
  ): SevenStructureResult | null {
    if (candles.length < 21) {
      return null;
    }

    const recent = candles.slice(-20);

    let positiveSessions = 0;
    let negativeSessions = 0;
    let totalMoves = 0;
    let absoluteMoves = 0;

    for (let i = 1; i < recent.length; i++) {
      const previous = recent[i - 1].close;
      const current = recent[i].close;

      if (previous <= 0) {
        continue;
      }

      const change = current - previous;

      if (change > 0) {
        positiveSessions++;
      } else if (change < 0) {
        negativeSessions++;
      }

      totalMoves++;
      absoluteMoves += Math.abs(change / previous);
    }

    if (totalMoves === 0) {
      return null;
    }

    const positiveSessionsRatio =
      (positiveSessions / totalMoves) * 100;

    const negativeSessionsRatio =
      (negativeSessions / totalMoves) * 100;

    /*
     * Une structure directionnelle est plus cohérente lorsque
     * les séances positives ou négatives dominent clairement.
     *
     * 50/50 = faible cohérence
     * 70/30 = bonne cohérence
     * 85/15 = très forte cohérence
     */
    const directionalConsistency =
      Math.abs(
        positiveSessionsRatio - negativeSessionsRatio,
      );

    const closes = recent.map((candle) => candle.close);
    const lowest = Math.min(...closes);
    const highest = Math.max(...closes);
    const current = closes[closes.length - 1];

    let rangePositionPercent = 50;

    if (highest > lowest) {
      rangePositionPercent =
        ((current - lowest) / (highest - lowest)) * 100;
    }

    /*
     * La position dans la fourchette est utilisée comme information
     * structurelle, pas comme signal automatique d'achat.
     *
     * Une position proche d'une extrémité montre simplement que
     * le cours se situe actuellement près d'un extrême récent.
     */
    const rangeComponent =
      this.clamp(
        Math.abs(rangePositionPercent - 50) * 2,
        0,
        100,
      );

    /*
     * Cohérence directionnelle : 60%
     * Position dans la range : 40%
     */
    const score =
      directionalConsistency * 0.6 +
      rangeComponent * 0.4;

    let quality:
      | 'faible'
      | 'moyenne'
      | 'bonne'
      | 'excellente';

    if (score < 40) {
      quality = 'faible';
    } else if (score < 60) {
      quality = 'moyenne';
    } else if (score < 80) {
      quality = 'bonne';
    } else {
      quality = 'excellente';
    }

    return {
      score: Math.round(score * 10) / 10,
      positiveSessionsRatio:
        Math.round(positiveSessionsRatio * 10) / 10,
      negativeSessionsRatio:
        Math.round(negativeSessionsRatio * 10) / 10,
      rangePositionPercent:
        Math.round(rangePositionPercent * 10) / 10,
      directionalConsistency:
        Math.round(directionalConsistency * 10) / 10,
      quality,
    };
  }

  /**
   * CRITÈRE 7/7 — CONFLUENCE FINALE
   *
   * Synthèse des six critères précédents.
   *
   * IMPORTANT :
   * Le score représente la qualité de la configuration technique
   * observée. Il ne représente PAS une probabilité de hausse ou de baisse.
   *
   * Pondérations :
   * Tendance    20%
   * Momentum    20%
   * Volume      10%
   * Liquidité   15%
   * Volatilité  10%
   * Structure   15%
   *
   * Les 10% restants correspondent à la fiabilité de l'historique.
   */
  computeConfluence(
    trend: SevenTrendResult | null,
    momentum: SevenMomentumResult | null,
    volume: SevenVolumeResult | null,
    liquidity: SevenLiquidityResult | null,
    volatility: SevenVolatilityResult | null,
    structure: SevenStructureResult | null,
    candlesCount: number,
  ): SevenConfluenceResult | null {
    if (
      !trend ||
      !momentum ||
      !volume ||
      !liquidity ||
      !volatility ||
      !structure
    ) {
      return null;
    }

    /*
     * Fiabilité :
     * 30 séances = minimum exploitable
     * 250 séances = très bonne base
     * 500 séances = maximum retenu
     */
    const reliability = this.clamp(
      ((candlesCount - 30) / 470) * 100,
      0,
      100,
    );

    const components = {
      trend: trend.score,
      momentum: momentum.score,
      volume: volume.score,
      liquidity: liquidity.score,
      volatility: volatility.score,
      structure: structure.score,
    };

    let score =
      trend.score * 0.20 +
      momentum.score * 0.20 +
      volume.score * 0.10 +
      liquidity.score * 0.15 +
      volatility.score * 0.10 +
      structure.score * 0.15 +
      reliability * 0.10;

    /*
     * Accord tendance/momentum.
     *
     * Les deux critères doivent idéalement raconter la même histoire.
     * S'ils sont opposés, on réduit légèrement la qualité de la
     * configuration sans supprimer complètement l'information.
     */
    let agreement = 50;

    if (
      trend.direction === 'haussiere' &&
      momentum.direction === 'positif'
    ) {
      agreement = 100;
    } else if (
      trend.direction === 'baissiere' &&
      momentum.direction === 'negatif'
    ) {
      agreement = 100;
    } else if (
      trend.direction === 'neutre' ||
      momentum.direction === 'neutre'
    ) {
      agreement = 50;
    } else {
      agreement = 20;
      score *= 0.90;
    }

    /*
     * Structure cohérente = bonus léger.
     * Structure faible = aucune destruction du score, seulement
     * une information de qualité du mouvement.
     */
    if (structure.score >= 80) {
      score += 3;
    } else if (structure.score < 40) {
      score -= 3;
    }

    score = this.clamp(score, 0, 100);

    let direction: SevenConfluenceDirection = 'neutre';

    if (
      trend.direction === 'haussiere' &&
      momentum.direction === 'positif'
    ) {
      direction = 'haussiere';
    } else if (
      trend.direction === 'baissiere' &&
      momentum.direction === 'negatif'
    ) {
      direction = 'baissiere';
    }

    /*
     * Confiance = qualité de l'historique + accord des signaux.
     *
     * Ce n'est toujours PAS une probabilité de rendement.
     */
    const confidence =
      reliability * 0.60 +
      agreement * 0.40;

    let reading:
      | 'faible'
      | 'neutre'
      | 'a_surveiller'
      | 'interessante'
      | 'forte'
      | 'exceptionnelle';

    if (score < 40) {
      reading = 'faible';
    } else if (score < 55) {
      reading = 'neutre';
    } else if (score < 70) {
      reading = 'a_surveiller';
    } else if (score < 80) {
      reading = 'interessante';
    } else if (score < 90) {
      reading = 'forte';
    } else {
      reading = 'exceptionnelle';
    }

    return {
      score: Math.round(score * 10) / 10,
      direction,
      confidence: Math.round(confidence * 10) / 10,
      reliability: Math.round(reliability * 10) / 10,
      components: {
        trend: Math.round(components.trend * 10) / 10,
        momentum: Math.round(components.momentum * 10) / 10,
        volume: Math.round(components.volume * 10) / 10,
        liquidity: Math.round(components.liquidity * 10) / 10,
        volatility: Math.round(components.volatility * 10) / 10,
        structure: Math.round(components.structure * 10) / 10,
      },
      agreement,
      reading,
    };
  }

  private clamp(
    value: number,
    min: number,
    max: number,
  ): number {
    return Math.max(min, Math.min(max, value));
  }


  /**
   * Classement KOUNADIA 7/7 de tout le marché BRVM.
   *
   * Le classement repose sur la qualité de la configuration technique
   * observée, et non sur une probabilité de hausse.
   */
  async analyzeTop(
    companies: Array<{ ticker: string }>,
    getHistory: (ticker: string) => Promise<BrvmCandle[]>,
    limit = 10,
  ) {
    const analyses = await Promise.allSettled(
      companies.map(async (company) => {
        const ticker = company.ticker.trim().toUpperCase();
        const candles = await getHistory(ticker);

        return this.analyze(ticker, candles);
      }),
    );

    const valid = analyses
      .filter(
        (
          result,
        ): result is PromiseFulfilledResult<
          ReturnType<BrvmSevenService["analyze"]>
        > => result.status === 'fulfilled',
      )
      .map((result) => result.value)
      .filter((analysis) => analysis.status === 'ok');

    const results = valid
      .filter((analysis) => analysis.confluence !== null)
      .sort(
        (a, b) =>
          (b.confluence?.score ?? 0) -
          (a.confluence?.score ?? 0),
      )
      .slice(0, Math.max(1, Math.min(48, limit)));

    return {
      count: results.length,
      results,
    };
  }

  analyze(ticker: string, candles: BrvmCandle[]) {
    const trend = this.computeTrend(candles);
    const momentum = this.computeMomentum(candles);
    const volume = this.computeVolume(candles);
    const liquidity = this.computeLiquidity(candles);
    const volatility = this.computeVolatility(candles);
    const structure = this.computeStructure(candles);
    const confluence = this.computeConfluence(
      trend,
      momentum,
      volume,
      liquidity,
      volatility,
      structure,
      candles.length,
    );

    return {
      ticker: ticker.trim().toUpperCase(),
      candles: candles.length,
      trend,
      momentum,
      volume,
      liquidity,
      volatility,
      structure,
      confluence,
      status:
        trend || momentum || volume
          ? 'ok'
          : 'historique_insuffisant',
    };
  }
}
