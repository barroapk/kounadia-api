import { Inject, Injectable } from '@nestjs/common';
import { BRVM_DATA_PROVIDER } from './brvm-data.constants';
import { BrvmCandle, BrvmCatalog } from './brvm.types';
import type { BrvmDataProvider, BrvmQuote } from './brvm.types';

@Injectable()
export class BrvmService {
  private cachedCatalog: { data: BrvmCatalog; expiresAt: number } | null = null;
  private readonly CACHE_DURATION_MS = 15 * 60 * 1000; // 15 min, aligné sur la fréquence de mise à jour de la source.

  private historyCache = new Map<string, { data: BrvmCandle[]; expiresAt: number }>();

  // Cache dédié pour la liste groupée de cotations : évite de tout recalculer
  // à chaque appel de /stocks/brvm/quotes, coûteux (48 requêtes réseau).
  private cachedQuotes: { data: BrvmQuote[]; expiresAt: number } | null = null;

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

  /**
   * Cotations de toutes les actions du catalogue en une seule réponse.
   * Calculées en parallèle côté serveur (avec cache), pour que Flutter
   * n'ait jamais à faire 48 appels réseau individuels pour afficher une liste.
   */
  async getAllQuotes(): Promise<BrvmQuote[]> {
    const now = Date.now();
    if (this.cachedQuotes && this.cachedQuotes.expiresAt > now) {
      return this.cachedQuotes.data;
    }

    const catalog = await this.getCatalog();

    const results = await Promise.allSettled(
      catalog.companies.map((c) => this.getQuote(c.ticker)),
    );

    const quotes = results
      .filter((r): r is PromiseFulfilledResult<BrvmQuote | null> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((q): q is BrvmQuote => q !== null);

    this.cachedQuotes = { data: quotes, expiresAt: now + this.CACHE_DURATION_MS };
    return quotes;
  }
}
