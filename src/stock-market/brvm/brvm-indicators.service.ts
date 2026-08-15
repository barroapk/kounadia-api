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
}
