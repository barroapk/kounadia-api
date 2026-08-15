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
}
