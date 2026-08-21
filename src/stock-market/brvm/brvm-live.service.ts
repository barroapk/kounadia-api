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
