import { Injectable } from '@nestjs/common';
import { BrvmCandle } from './brvm.types';

export type EntryStatus =
  | 'BUY_NOW'
  | 'BUY_BREAKOUT'
  | 'WAIT_FOR_PULLBACK'
  | 'HOLD'
  | 'AVOID';

export interface EntryInputData {
  ticker: string;
  score77: number;
  direction?: 'haussiere' | 'baissiere' | 'neutre';
  lastClose: number;
  lastSma20: number | null;
  lastRsi: number | null;
}

export interface EntryAnalysis {
  status: EntryStatus;
  statusFr: string;
  timingScore: number;
  decisionExplanation: string;

  support: number | null;
  resistance: number | null;

  idealEntryZone: {
    min: number;
    max: number;
  } | null;

  riskRewardRatio: number | null;

  sma20DistancePercent: number | null;
  sma20Score: number;

  rsiValue: number | null;
  rsiScore: number;

  breakout: {
    isBreakout: boolean;
    isVolumeConfirmed: boolean;
    breakoutLevel: number | null;
  };

  flags: string[];
}

@Injectable()
export class BrvmEntryService {
  public analyzeEntry(
    input: EntryInputData,
    candles: BrvmCandle[],
  ): EntryAnalysis {
    if (!candles || candles.length < 20) {
      return this.buildDefaultResult(
        'Historique de bougies insuffisant pour évaluer le timing.',
      );
    }

    const {
      score77,
      direction = 'haussiere',
      lastClose,
      lastSma20,
      lastRsi,
    } = input;

    const flags: string[] = [];

    const { support, resistance } =
      this.findSupportAndResistance(candles, lastClose);

    const sma20Dist =
      lastSma20 && lastSma20 > 0
        ? ((lastClose - lastSma20) / lastSma20) * 100
        : null;

    const sma20Score = this.scoreSmaDistance(sma20Dist, flags);
    const rsiScore = this.scoreRsi(lastRsi, flags);

    const breakout = this.detectBreakout(candles, resistance);

    if (breakout.isBreakout) {
      if (breakout.isVolumeConfirmed) {
        flags.push(
          `BREAKOUT_CONFIRMÉ (${breakout.breakoutLevel} FCFA)`,
        );
      } else {
        flags.push(
          `BREAKOUT_SANS_VOLUME (${breakout.breakoutLevel} FCFA)`,
        );
      }
    }

    const idealEntryZone = this.calculateIdealEntryZone(
      lastClose,
      lastSma20,
      support,
    );

    const riskRewardRatio = this.calculateRiskRewardRatio(
      lastClose,
      support,
      resistance,
    );

    let timingScore = Math.round(
      sma20Score * 0.45 +
        rsiScore * 0.45 +
        (riskRewardRatio
          ? Math.min(riskRewardRatio * 20, 100)
          : 50) *
          0.1,
    );

    if (breakout.isBreakout && breakout.isVolumeConfirmed) {
      timingScore = Math.min(100, timingScore + 20);
    }

    const decision = this.decideAction(
      score77,
      direction,
      timingScore,
      sma20Dist,
      lastRsi,
      breakout,
      riskRewardRatio,
    );

    return {
      status: decision.status,
      statusFr: decision.statusFr,
      timingScore,
      decisionExplanation: decision.explanation,

      support,
      resistance,
      idealEntryZone,

      riskRewardRatio:
        riskRewardRatio !== null
          ? Math.round(riskRewardRatio * 100) / 100
          : null,

      sma20DistancePercent:
        sma20Dist !== null
          ? Math.round(sma20Dist * 100) / 100
          : null,

      sma20Score,

      rsiValue:
        lastRsi !== null
          ? Math.round(lastRsi * 10) / 10
          : null,

      rsiScore,

      breakout,
      flags,
    };
  }

  private scoreSmaDistance(
    dist: number | null,
    flags: string[],
  ): number {
    if (dist === null) return 50;

    // Zone idéale autour du SMA20
    if (dist >= -3 && dist <= 3) {
      return 100;
    }

    // Léger repli sous le SMA20
    if (dist >= -6 && dist < -3) {
      return 90;
    }

    // Repli important : confirmation nécessaire
    if (dist >= -10 && dist < -6) {
      flags.push(
        `REPLI_SMA20 (${dist.toFixed(1)}%)`,
      );
      return 65;
    }

    // Forte baisse sous le SMA20
    if (dist < -10) {
      flags.push(
        `ÉLOIGNEMENT_SMA20_BAISSE (${dist.toFixed(1)}%)`,
      );
      return 30;
    }

    // Cours au-dessus du SMA20
    if (dist <= 6) {
      return 85;
    }

    if (dist <= 8) {
      return 65;
    }

    if (dist <= 12) {
      flags.push(
        `ÉLOIGNEMENT_SMA20 (${dist >= 0 ? '+' : ''}${dist.toFixed(1)}%)`,
      );
      return 35;
    }

    // Extension extrême
    flags.push(
      `EXTENSION_EXTRÊME_SMA20 (${dist >= 0 ? '+' : ''}${dist.toFixed(1)}%)`,
    );

    return 10;
  }

  private scoreRsi(
    rsi: number | null,
    flags: string[],
  ): number {
    if (rsi === null) return 50;

    /*
     * RSI utilisé uniquement comme indicateur de TIMING.
     * Il ne représente pas une probabilité de hausse.
     *
     * Zone recherchée :
     * 50-65  -> timing favorable
     * 65-75  -> encore exploitable mais plus chaud
     * >75    -> surchauffe progressive
     * <40    -> faiblesse / prudence
     */

    // RSI extrêmement faible
    if (rsi < 30) {
      flags.push(`RSI_TRÈS_FAIBLE (${rsi.toFixed(1)})`);
      return 20;
    }

    // RSI 30-40 : faiblesse importante
    if (rsi < 40) {
      flags.push(`RSI_FAIBLE (${rsi.toFixed(1)})`);
      return 35 + ((rsi - 30) / 10) * 10;
    }

    // RSI 40-50 : récupération / zone neutre
    if (rsi < 50) {
      return 45 + ((rsi - 40) / 10) * 15;
    }

    // RSI 50-60 : zone idéale
    if (rsi <= 60) {
      return 60 + ((rsi - 50) / 10) * 40;
    }

    // RSI 60-65 : toujours très favorable
    if (rsi <= 65) {
      return 100 - ((rsi - 60) / 5) * 5;
    }

    // RSI 65-70 : début de surchauffe
    if (rsi <= 70) {
      return 95 - ((rsi - 65) / 5) * 15;
    }

    // RSI 70-75 : prudence accrue
    if (rsi <= 75) {
      flags.push(`RSI_CHAUD (${rsi.toFixed(1)})`);
      return 80 - ((rsi - 70) / 5) * 25;
    }

    // RSI 75-85 : surchauffe
    if (rsi <= 85) {
      flags.push(`RSI_SURCHAUFFE (${rsi.toFixed(1)})`);
      return 55 - ((rsi - 75) / 10) * 35;
    }

    // RSI >85 : extrême
    flags.push(`RSI_EXTRÊME (${rsi.toFixed(1)})`);
    return 20;
  }

  private findSupportAndResistance(
    candles: BrvmCandle[],
    currentPrice: number,
  ): {
    support: number | null;
    resistance: number | null;
  } {
    const lookback = Math.min(60, candles.length);
    const recent = candles.slice(-lookback);

    let nearestResistance = Infinity;
    let nearestSupport = -Infinity;

    for (let i = 2; i < recent.length - 2; i++) {
      const candle = recent[i];

      const isPivotHigh =
        candle.high >= recent[i - 1].high &&
        candle.high >= recent[i - 2].high &&
        candle.high >= recent[i + 1].high &&
        candle.high >= recent[i + 2].high;

      const isPivotLow =
        candle.low <= recent[i - 1].low &&
        candle.low <= recent[i - 2].low &&
        candle.low <= recent[i + 1].low &&
        candle.low <= recent[i + 2].low;

      if (
        isPivotHigh &&
        candle.high > currentPrice &&
        candle.high < nearestResistance
      ) {
        nearestResistance = candle.high;
      }

      if (
        isPivotLow &&
        candle.low < currentPrice &&
        candle.low > nearestSupport
      ) {
        nearestSupport = candle.low;
      }
    }

    return {
      support:
        nearestSupport !== -Infinity
          ? nearestSupport
          : null,

      resistance:
        nearestResistance !== Infinity
          ? nearestResistance
          : null,
    };
  }

  private detectBreakout(
    candles: BrvmCandle[],
    resistance: number | null,
  ): {
    isBreakout: boolean;
    isVolumeConfirmed: boolean;
    breakoutLevel: number | null;
  } {
    /*
     * Le breakout doit être évalué contre une résistance
     * connue AVANT la bougie actuelle.
     *
     * On ne doit jamais utiliser une résistance calculée
     * à partir du dernier close comme niveau à casser.
     */

    if (candles.length < 22) {
      return {
        isBreakout: false,
        isVolumeConfirmed: false,
        breakoutLevel: null,
      };
    }

    const last = candles[candles.length - 1];
    const previous = candles.slice(0, -1);

    /*
     * Résistance historique disponible avant la bougie actuelle.
     *
     * On utilise uniquement les bougies précédentes afin
     * d'éviter toute fuite d'information.
     */
    const lookback = Math.min(60, previous.length);
    const recent = previous.slice(-lookback);

    let previousResistance: number | null = null;

    for (let i = 2; i < recent.length - 2; i++) {
      const candle = recent[i];

      const isPivotHigh =
        candle.high >= recent[i - 1].high &&
        candle.high >= recent[i - 2].high &&
        candle.high >= recent[i + 1].high &&
        candle.high >= recent[i + 2].high;

      if (!isPivotHigh) {
        continue;
      }

      /*
       * Une résistance pertinente doit être au-dessus
       * du cours de clôture précédent.
       */
      if (
        candle.high > previous[previous.length - 1].close &&
        (
          previousResistance === null ||
          candle.high < previousResistance
        )
      ) {
        previousResistance = candle.high;
      }
    }

    /*
     * Si aucune résistance historique exploitable n'est trouvée,
     * on ne force jamais un breakout.
     */
    if (previousResistance === null) {
      return {
        isBreakout: false,
        isVolumeConfirmed: false,
        breakoutLevel: null,
      };
    }

    /*
     * La cassure doit être réelle :
     *
     * close(T-1) <= résistance
     * close(T)   > résistance
     */
    const previousClose = previous[previous.length - 1].close;

    const isBreak =
      previousClose <= previousResistance &&
      last.close > previousResistance;

    if (!isBreak) {
      return {
        isBreakout: false,
        isVolumeConfirmed: false,
        breakoutLevel: null,
      };
    }

    /*
     * Confirmation du volume :
     * volume actuel >= 1.5 × moyenne des 20 séances précédentes.
     */
    const previous20 = candles.slice(-21, -1);

    const avgVolume =
      previous20.reduce(
        (sum, candle) => sum + candle.volume,
        0,
      ) / previous20.length;

    const isVolumeConfirmed =
      avgVolume > 0 &&
      last.volume >= avgVolume * 1.5;

    return {
      isBreakout: true,
      isVolumeConfirmed,
      breakoutLevel: previousResistance,
    };
  }

  private calculateIdealEntryZone(
    currentPrice: number,
    sma20: number | null,
    support: number | null,
  ): {
    min: number;
    max: number;
  } | null {
    const references = [sma20, support]
      .filter(
        (value): value is number =>
          value !== null && value > 0,
      )
      .sort((a, b) => b - a);

    const ref = references[0];

    if (!ref) return null;

    const min = Math.round(ref);
    const max = Math.round(ref * 1.03);

    if (max >= currentPrice) {
      return null;
    }

    return { min, max };
  }

  private calculateRiskRewardRatio(
    currentPrice: number,
    support: number | null,
    resistance: number | null,
  ): number | null {
    if (
      support === null ||
      resistance === null
    ) {
      return null;
    }

    const risk = currentPrice - support;
    const reward = resistance - currentPrice;

    if (risk <= 0 || reward <= 0) {
      return null;
    }

    return reward / risk;
  }

  private decideAction(
    score77: number,
    direction:
      | 'haussiere'
      | 'baissiere'
      | 'neutre',
    timingScore: number,
    sma20Dist: number | null,
    rsi: number | null,
    breakout: {
      isBreakout: boolean;
      isVolumeConfirmed: boolean;
    },
    riskReward: number | null,
  ): {
    status: EntryStatus;
    statusFr: string;
    explanation: string;
  } {
    if (
      direction === 'baissiere' ||
      score77 < 60
    ) {
      return {
        status: 'AVOID',
        statusFr: 'Éviter',
        explanation:
          'Configuration technique globale insuffisante ou tendance baissière.',
      };
    }

    if (
      breakout.isBreakout &&
      breakout.isVolumeConfirmed
    ) {
      return {
        status: 'BUY_BREAKOUT',
        statusFr: 'Acheter la cassure',
        explanation:
          'Cassure de résistance confirmée par un volume élevé.',
      };
    }

    if (score77 >= 75) {
      if (
        timingScore < 45 ||
        (sma20Dist !== null && sma20Dist > 10) ||
        (rsi !== null && rsi > 80)
      ) {
        return {
          status: 'WAIT_FOR_PULLBACK',
          statusFr: 'Attendre un repli',
          explanation:
            `Configuration 7/7 très forte (${score77}/100), ` +
            `mais le point d'entrée est trop étendu ` +
            `(SMA20: ${sma20Dist !== null ? `+${sma20Dist.toFixed(1)}%` : 'N/A'}, ` +
            `RSI: ${rsi !== null ? rsi.toFixed(1) : 'N/A'}). ` +
            'Attendre une consolidation ou un repli.',
        };
      }

      if (timingScore >= 65) {
        return {
          status: 'BUY_NOW',
          statusFr: 'Achat immédiat',
          explanation:
            `Excellente configuration 7/7 (${score77}/100) ` +
            'avec un timing d’entrée favorable.',
        };
      }

      return {
        status: 'HOLD',
        statusFr: 'Conserver / attendre',
        explanation:
          'Configuration globale forte, mais le point d’entrée peut être amélioré.',
      };
    }

    if (
      timingScore >= 75 &&
      (riskReward === null || riskReward >= 1.5)
    ) {
      return {
        status: 'BUY_NOW',
        statusFr: 'Achat immédiat',
        explanation:
          'Configuration correcte avec un point d’entrée présentant un rapport risque/rendement acceptable.',
      };
    }

    return {
      status: 'HOLD',
      statusFr: 'Conserver',
      explanation:
        'Pas de signal suffisamment fort pour une nouvelle entrée immédiate.',
    };
  }

  private buildDefaultResult(
    explanation: string,
  ): EntryAnalysis {
    return {
      status: 'AVOID',
      statusFr: 'Éviter',
      timingScore: 0,
      decisionExplanation: explanation,
      support: null,
      resistance: null,
      idealEntryZone: null,
      riskRewardRatio: null,
      sma20DistancePercent: null,
      sma20Score: 0,
      rsiValue: null,
      rsiScore: 0,
      breakout: {
        isBreakout: false,
        isVolumeConfirmed: false,
        breakoutLevel: null,
      },
      flags: ['DONNÉES_INSUFFISANTES'],
    };
  }
}
