import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { BrvmLiveQuote } from './brvm.types';
import { SupabaseService } from '../../supabase/supabase.service';

@Injectable()
export class BrvmLiveService {
  private readonly logger = new Logger(BrvmLiveService.name);

  private readonly url = 'https://www.brvm.org/fr/cours-actions/0';

  // Le backend interroge la BRVM au maximum une fois toutes les 60 secondes.
  private readonly CACHE_TTL_MS = 60 * 1000;

  private cache: {
    quotes: BrvmLiveQuote[];
    fetchedAt: string;
    expiresAt: number;
  } | null = null;

  private refreshPromise: Promise<BrvmLiveQuote[]> | null = null;

  constructor(
    private readonly http: HttpService,
    private readonly supabase: SupabaseService,
  ) {}

  /**
   * Restaure les dernières cotations depuis Supabase.
   *
   * Utile après un redémarrage de Render : le cache mémoire
   * est vide, mais les dernières données restent disponibles
   * dans Supabase.
   */
  private async loadFromSupabase(): Promise<BrvmLiveQuote[] | null> {
    const { data, error } = await this.supabase.client
      .from('brvm_live_quotes')
      .select('ticker, price, change_percent, source, fetched_at')
      .order('ticker');

    if (error) {
      this.logger.warn(
        `Lecture Supabase BRVM impossible : ${error.message}`,
      );
      return null;
    }

    if (!data || data.length === 0) {
      return null;
    }

    const quotes: BrvmLiveQuote[] = data.map((row) => ({
      ticker: row.ticker,
      price: Number(row.price),
      changePercent:
        row.change_percent === null
          ? null
          : Number(row.change_percent),
      source: 'brvm_official',
      fetchedAt: row.fetched_at,
    }));

    const latestFetchedAt = quotes.reduce(
      (latest, quote) =>
        quote.fetchedAt > latest ? quote.fetchedAt : latest,
      quotes[0].fetchedAt,
    );

    this.cache = {
      quotes,
      fetchedAt: latestFetchedAt,
      expiresAt: Date.now() + this.CACHE_TTL_MS,
    };

    this.logger.log(
      `Cache BRVM restauré depuis Supabase : ${quotes.length} cotations`,
    );

    return quotes;
  }

  /**
   * Récupération publique.
   *
   * Les utilisateurs de KOUNADIA lisent le cache.
   * Un seul appel réseau vers la BRVM est effectué lorsque le cache expire.
   */
  async getLiveQuotes(): Promise<BrvmLiveQuote[]> {
    const now = Date.now();

    // Cache encore valide → aucun appel à la BRVM.
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.quotes;
    }

    // Si un rafraîchissement est déjà en cours, tout le monde
    // attend le même appel au lieu de créer plusieurs appels BRVM.
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    // Après un redémarrage du serveur, restaurer d'abord
    // les dernières données persistées dans Supabase.
    const restored = await this.loadFromSupabase();

    if (restored && restored.length > 0) {
      return restored;
    }

    this.refreshPromise = this.refreshCache();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Appelé périodiquement pour garder le cache chaud.
   */
  async refreshNow(): Promise<BrvmLiveQuote[]> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.refreshCache();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Récupère les données officielles BRVM et remplit le cache.
   */
  private async refreshCache(): Promise<BrvmLiveQuote[]> {
    const fetchedAt = new Date().toISOString();

    try {
      this.logger.log('Actualisation des cotations BRVM...');

      const response = await firstValueFrom(
        this.http.get(this.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Android 16; Mobile)',
            Accept: 'text/html,application/xhtml+xml',
          },
          timeout: 30000,
          responseType: 'text',
        }),
      );

      const html = String(response.data);

      const pattern =
        /<div class="item"><span>([A-Z0-9]+)<\/span>&nbsp;<span>([^<]+)<\/span>&nbsp;<span>([^<]+)%<\/span>/g;

      const quotes: BrvmLiveQuote[] = [];

      let match: RegExpExecArray | null;

      while ((match = pattern.exec(html)) !== null) {
        const ticker = match[1].trim().toUpperCase();

        const price = Number(
          match[2]
            .replace(/\s/g, '')
            .replace(',', '.'),
        );

        const changePercent = Number(
          match[3]
            .trim()
            .replace(',', '.'),
        );

        if (!Number.isFinite(price)) {
          continue;
        }

        quotes.push({
          ticker,
          price,
          changePercent: Number.isFinite(changePercent)
            ? changePercent
            : null,
          source: 'brvm_official',
          fetchedAt,
        });
      }

      // Protection contre une réponse BRVM vide ou un changement
      // de structure HTML.
      if (quotes.length === 0) {
        throw new Error(
          'Aucune cotation BRVM extraite depuis la page officielle',
        );
      }

      // Persistance Supabase : les dernières cotations restent disponibles
      // même après un redémarrage du serveur Render.
      const rows = quotes.map((quote) => ({
        ticker: quote.ticker,
        price: quote.price,
        change_percent: quote.changePercent,
        source: quote.source,
        fetched_at: quote.fetchedAt,
      }));

      const { error: supabaseError } = await this.supabase.client
        .from('brvm_live_quotes')
        .upsert(rows, { onConflict: 'ticker' });

      if (supabaseError) {
        this.logger.warn(
          `Sauvegarde Supabase BRVM échouée : ${supabaseError.message}`,
        );
      } else {
        this.logger.log(
          `Supabase BRVM synchronisée : ${rows.length} cotations`,
        );
      }

      this.cache = {
        quotes,
        fetchedAt,
        expiresAt: Date.now() + this.CACHE_TTL_MS,
      };

      this.logger.log(
        `Cache BRVM actualisé : ${quotes.length} cotations`,
      );

      return quotes;
    } catch (error) {
      this.logger.error(
        `Échec actualisation BRVM : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      // Si nous avons déjà un cache valide ou ancien,
      // on le conserve plutôt que de casser KOUNADIA.
      if (this.cache) {
        this.logger.warn(
          'Utilisation des dernières données BRVM disponibles.',
        );

        return this.cache.quotes;
      }

      throw error;
    }
  }

  /**
   * Informations utiles pour diagnostiquer le cache.
   */
  getCacheStatus() {
    if (!this.cache) {
      return {
        ready: false,
        quotesCount: 0,
        fetchedAt: null,
        expiresAt: null,
        ageSeconds: null,
      };
    }

    return {
      ready: true,
      quotesCount: this.cache.quotes.length,
      fetchedAt: this.cache.fetchedAt,
      expiresAt: new Date(this.cache.expiresAt).toISOString(),
      ageSeconds: Math.round(
        (Date.now() - new Date(this.cache.fetchedAt).getTime()) / 1000,
      ),
    };
  }
}
