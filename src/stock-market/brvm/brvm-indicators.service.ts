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
}
