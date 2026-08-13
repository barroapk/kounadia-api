import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { BrvmCandle, BrvmCatalog, BrvmDataProvider, BrvmQuote } from './brvm.types';
import { BRVM_COMPANY_NAMES } from './brvm-companies-catalog';

@Injectable()
export class GitHubBrvmProvider implements BrvmDataProvider {
  private readonly baseUrl = 'https://raw.githubusercontent.com/Fredysessie/brvm-data-public/main/data';

  constructor(private readonly http: HttpService) {}

  async getCatalog(): Promise<BrvmCatalog> {
    const response = await firstValueFrom(this.http.get(`${this.baseUrl}/metadata.json`));
    const data = response.data;

    if (!data || !Array.isArray(data.tickers_list)) {
      throw new Error('Format metadata BRVM invalide : tickers_list manquant');
    }
    if (!Array.isArray(data.indexes_list)) {
      throw new Error('Format metadata BRVM invalide : indexes_list manquant');
    }

    const companies = data.tickers_list
      .filter((ticker: unknown): ticker is string => typeof ticker === 'string')
      .map((ticker: string) => ticker.trim())
      .filter((ticker: string) => ticker.length > 0)
      .map((ticker: string) => {
        const known = BRVM_COMPANY_NAMES[ticker];
        return {
          ticker,
          // Si le ticker n'est pas encore dans notre catalogue de noms
          // (nouvelle admission par exemple), on renvoie null plutôt que
          // d'inventer un nom : Flutter doit alors se rabattre sur le ticker seul.
          name: known?.name ?? null,
          country: known?.country ?? null,
        };
      });

    const indexes = data.indexes_list
      .filter((index: unknown): index is string => typeof index === 'string')
      .map((index: string) => index.trim())
      .filter((index: string) => index.length > 0);

    return {
      companies,
      indexes,
      lastUpdated: typeof data.last_updated === 'string' ? data.last_updated : null,
    };
  }

  /**
   * Parse le CSV "Date,Open,High,Low,Close,Volume" en ignorant silencieusement
   * les lignes invalides (en-tête, lignes vides, valeurs non numériques),
   * plutôt que de faire échouer tout l'historique pour une seule ligne mal formée.
   */
  private parseCsv(raw: string): BrvmCandle[] {
    const lines = raw.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    const candles: BrvmCandle[] = [];

    for (const line of lines) {
      const parts = line.split(',');
      if (parts.length !== 6) continue;

      const [date, openStr, highStr, lowStr, closeStr, volumeStr] = parts;
      if (date === 'Date') continue; // en-tête

      const open = Number(openStr);
      const high = Number(highStr);
      const low = Number(lowStr);
      const close = Number(closeStr);
      const volume = Number(volumeStr);

      if (![open, high, low, close, volume].every((n) => Number.isFinite(n))) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

      candles.push({ date, open, high, low, close, volume });
    }

    // Ordre chronologique croissant : le CSV source l'est déjà, mais on ne
    // suppose jamais un ordre garanti venant d'une source externe.
    candles.sort((a, b) => a.date.localeCompare(b.date));
    return candles;
  }

  async getHistory(ticker: string): Promise<BrvmCandle[]> {
    const normalizedTicker = ticker.trim().toUpperCase();

    try {
      const response = await firstValueFrom(
        this.http.get(`${this.baseUrl}/${normalizedTicker}/${normalizedTicker}.daily.csv`, {
          responseType: 'text',
        }),
      );
      return this.parseCsv(String(response.data));
    } catch (error: any) {
      // 404 = ticker inexistant côté source : on retourne un historique vide,
      // pas une exception qui ferait planter la requête HTTP en 500.
      if (error?.response?.status === 404) return [];
      throw error;
    }
  }

  async getQuote(ticker: string): Promise<BrvmQuote | null> {
    const candles = await this.getHistory(ticker);
    if (candles.length === 0) return null;

    const last = candles[candles.length - 1];
    const previous = candles.length >= 2 ? candles[candles.length - 2] : null;

    const previousClose = previous?.close ?? null;
    const change = previousClose !== null ? last.close - previousClose : null;
    const changePercent = previousClose !== null && previousClose !== 0 ? (change! / previousClose) * 100 : null;

    return {
      ticker: ticker.trim().toUpperCase(),
      date: last.date,
      open: last.open,
      high: last.high,
      low: last.low,
      close: last.close,
      volume: last.volume,
      previousClose,
      change,
      changePercent,
    };
  }
}
