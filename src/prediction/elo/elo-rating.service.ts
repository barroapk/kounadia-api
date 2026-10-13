import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { EloService } from './elo.service';
import { EloMatch, TeamEloState, EloPredictionExplained } from './elo.types';

interface CacheEntry {
  ratings: Map<string, TeamEloState>;
  expiresAt: number;
}

@Injectable()
export class EloRatingService {
  private readonly logger = new Logger(EloRatingService.name);
  private readonly CACHE_DURATION_MS = 60 * 60 * 1000; // 1h, aligne avec le rythme de sync de match_history
  private cache = new Map<string, CacheEntry>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly eloService: EloService,
  ) {}

  /**
   * Charge tout l'historique FINISHED d'une competition depuis
   * match_history, avec pagination (Supabase plafonne a 1000 lignes par
   * requete par defaut - le manquer a deja fausse un backtest complet
   * dans cette session).
   */
  private async loadMatchHistory(competition: string): Promise<EloMatch[]> {
    let matches: EloMatch[] = [];
    let from = 0;
    const pageSize = 1000;

    while (true) {
      const { data, error } = await this.supabase.client
        .from('match_history')
        .select('home_team, away_team, home_score, away_score, utc_date, competition')
        .eq('competition', competition)
        .eq('status', 'FINISHED')
        .not('home_score', 'is', null)
        .not('away_score', 'is', null)
        .order('utc_date', { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) {
        this.logger.error(`Erreur chargement match_history (${competition}): ${error.message}`);
        throw error;
      }

      const mapped: EloMatch[] = data.map((m) => ({
        homeTeam: m.home_team,
        awayTeam: m.away_team,
        homeScore: m.home_score,
        awayScore: m.away_score,
        utcDate: m.utc_date,
        competition: m.competition,
      }));

      matches = matches.concat(mapped);
      if (data.length < pageSize) break;
      from += pageSize;
    }

    return matches;
  }

  /**
   * Ratings actuels de toutes les equipes d'une competition, avec cache
   * 1h (le recalcul complet est rapide en memoire, mais evite de refaire
   * l'aller-retour Supabase + pagination a chaque requete).
   */
  async getRatings(competition: string): Promise<Map<string, TeamEloState>> {
    const cached = this.cache.get(competition);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.ratings;
    }

    const matches = await this.loadMatchHistory(competition);
    const ratings = this.eloService.computeRatings(matches);

    this.cache.set(competition, { ratings, expiresAt: now + this.CACHE_DURATION_MS });
    return ratings;
  }

  /**
   * Prediction traçable pour un match a venir. Retourne null si l'une des
   * deux equipes n'a aucun historique dans cette competition (Elo
   * commencerait a 1500 sans aucune information - preferable de le
   * signaler plutot que de renvoyer une fausse confiance).
   */
  async predictMatch(
    competition: string,
    homeTeam: string,
    awayTeam: string,
  ): Promise<EloPredictionExplained | null> {
    const ratings = await this.getRatings(competition);

    const homeState = ratings.get(homeTeam);
    const awayState = ratings.get(awayTeam);

    if (!homeState || !awayState) {
      this.logger.warn(`Elo indisponible pour ${homeTeam} vs ${awayTeam} (${competition}) : equipe(s) inconnue(s) de l'historique`);
      return null;
    }

    return this.eloService.predictMatch(homeTeam, awayTeam, homeState, awayState);
  }
}
