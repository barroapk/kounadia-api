import { Inject, Injectable } from '@nestjs/common';
import { BRVM_DATA_PROVIDER } from './brvm-data.constants';
import { BrvmCandle, BrvmCatalog } from './brvm.types';
import type { BrvmDataProvider, BrvmQuote } from './brvm.types';

@Injectable()
export class BrvmService {
  private cachedCatalog: { data: BrvmCatalog; expiresAt: number } | null = null;
  private readonly CACHE_DURATION_MS = 15 * 60 * 1000; // 15 min, aligné sur la fréquence de mise à jour de la source.

  // Cache par ticker pour l'historique/cours (mêmes 15 min).
  private historyCache = new Map<string, { data: BrvmCandle[]; expiresAt: number }>();

  constructor(
    @Inject(BRVM_DATA_PROVIDER)
    private readonly provider: BrvmDataProvider,
  ) {}

  async getCatalog(): Promise<BrvmCatalog> {
    const now = Date.now();
    if (this.cachedCatalog && this.cachedCatalog.expiresAt > now) {
      return this.cachedCatalog.data;
    }

    const catalog = await this.provider.getCatalog();
    this.cachedCatalog = { data: catalog, expiresAt: now + this.CACHE_DURATION_MS };
    return catalog;
  }

  async getHistory(ticker: string): Promise<BrvmCandle[]> {
    const key = ticker.trim().toUpperCase();
    const now = Date.now();
    const cached = this.historyCache.get(key);
    if (cached && cached.expiresAt > now) return cached.data;

    const history = await this.provider.getHistory(key);
    this.historyCache.set(key, { data: history, expiresAt: now + this.CACHE_DURATION_MS });
    return history;
  }

  async getQuote(ticker: string): Promise<BrvmQuote | null> {
    // Réutilise le cache d'historique : évite un deuxième appel réseau
    // pour le même ticker dans la même fenêtre de cache.
    const history = await this.getHistory(ticker);
    if (history.length === 0) return null;

    const last = history[history.length - 1];
    const previous = history.length >= 2 ? history[history.length - 2] : null;
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
