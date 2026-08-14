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

  /**
   * Cotations des indices BRVM (ex: BRVMC = Composite, BRVM30). Réutilise
   * directement getQuote() : un indice est traité exactement comme une
   * action, sauf que son volume est toujours 0 (pas un volume de
   * transactions, ne pas l'interpréter comme tel côté Flutter).
   */
  // Limité aux deux indices principaux pour le dashboard : les autres
  // indices du catalogue (BRVMSP, BRVMTR...) ont une dernière donnée figée
  // au 31/12/2025 dans la source actuelle, donc trompeurs affichés comme
  // "cotation actuelle". Réservés à une future section "indices sectoriels"
  // où leur date sera explicitement affichée.
  private readonly FEATURED_INDEXES = ['BRVMC', 'BRVM30'];

  async getIndexQuotes(): Promise<BrvmQuote[]> {
    const results = await Promise.allSettled(
      this.FEATURED_INDEXES.map((ticker) => this.getQuote(ticker)),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<BrvmQuote | null> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((q): q is BrvmQuote => q !== null);
  }
}
