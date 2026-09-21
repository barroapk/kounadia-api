import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { EloRatingService } from '../elo/elo-rating.service';
import { OrderedLogitService } from './ordered-logit.service';
import { OrderedLogitParams, OrderedLogitPredictionExplained, OutcomeRecord } from './ordered-logit.types';

interface CacheEntry {
  params: OrderedLogitParams;
  expiresAt: number;
}

@Injectable()
export class OrderedLogitRatingService {
  private readonly logger = new Logger(OrderedLogitRatingService.name);
  private readonly CACHE_DURATION_MS = 60 * 60 * 1000; // 1h, aligne avec le rythme de sync de match_history
  private cache = new Map<string, CacheEntry>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly eloRatingService: EloRatingService,
    private readonly orderedLogitService: OrderedLogitService,
  ) {}

  private async loadMatchHistory(competition: string): Promise<
    { homeTeam: string; awayTeam: string; homeScore: number; awayScore: number; utcDate: string }[]
  > {
    let matches: { homeTeam: string; awayTeam: string; homeScore: number; awayScore: number; utcDate: string }[] = [];
    let from = 0;
    const pageSize = 1000;

    while (true) {
      const { data, error } = await this.supabase.client
        .from('match_history')
        .select('home_team, away_team, home_score, away_score, utc_date')
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

      const mapped = data.map((m) => ({
        homeTeam: m.home_team,
        awayTeam: m.away_team,
        homeScore: m.home_score,
        awayScore: m.away_score,
        utcDate: m.utc_date,
      }));

      matches = matches.concat(mapped);
      if (data.length < pageSize) break;
      from += pageSize;
    }

    return matches;
  }

  /**
   * Ajuste les parametres de l'Ordered Logit sur tout l'historique
   * disponible d'une competition, avec cache 1h. Reconstruit les ratings
   * Elo chronologiquement (via EloService) pour calculer eloDiff a chaque
   * match, exactement comme lors de la validation.
   */
  async getParams(competition: string): Promise<OrderedLogitParams | null> {
    const cached = this.cache.get(competition);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.params;
    }

    const matches = await this.loadMatchHistory(competition);
    if (matches.length < 100) {
      this.logger.warn(`Historique insuffisant pour ordered_logit (${competition}) : ${matches.length} matchs`);
      return null;
    }

    // Reconstruit les ratings Elo chronologiquement pour obtenir eloDiff
    // AVANT chaque match (jamais apres) - meme logique que EloService.
    const eloMatches = matches.map((m) => ({
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      homeScore: m.homeScore,
      awayScore: m.awayScore,
      utcDate: m.utcDate,
    }));

    const outcomeRecords: OutcomeRecord[] = [];
    const ratingsSnapshot = new Map<string, number>();
    const INITIAL_RATING = 1500;
    const HOME_ADVANTAGE = 60;
    const K_FACTOR = 20;

    const getRating = (team: string) => ratingsSnapshot.get(team) ?? INITIAL_RATING;
    const expectedScore = (a: number, b: number) => 1 / (1 + Math.pow(10, (b - a) / 400));
    const goalDiffMultiplier = (gd: number) => {
      const abs = Math.abs(gd);
      if (abs <= 1) return 1;
      if (abs === 2) return 1.5;
      return (11 + abs) / 8;
    };

    for (const m of eloMatches) {
      const homeRating = getRating(m.homeTeam);
      const awayRating = getRating(m.awayTeam);
      const eloDiff = (homeRating - awayRating) / 400;

      let outcome: 'home' | 'draw' | 'away';
      if (m.homeScore > m.awayScore) outcome = 'home';
      else if (m.homeScore < m.awayScore) outcome = 'away';
      else outcome = 'draw';

      outcomeRecords.push({ eloDiff, outcome });

      const expectedHome = expectedScore(homeRating + HOME_ADVANTAGE, awayRating);
      let actualHome: number;
      if (outcome === 'home') actualHome = 1;
      else if (outcome === 'away') actualHome = 0;
      else actualHome = 0.5;
      const multiplier = goalDiffMultiplier(m.homeScore - m.awayScore);
      ratingsSnapshot.set(m.homeTeam, homeRating + K_FACTOR * multiplier * (actualHome - expectedHome));
      ratingsSnapshot.set(m.awayTeam, awayRating + K_FACTOR * multiplier * ((1 - actualHome) - (1 - expectedHome)));
    }

    const fit = this.orderedLogitService.fit(outcomeRecords, null, { maxIter: 200, tolGradient: 1e-6 });
    if (!fit.converged) {
      this.logger.warn(`ordered_logit (${competition}) : non convergent apres ${fit.iterUsed} iterations`);
    }

    const params: OrderedLogitParams = { beta: fit.beta, mu: fit.mu, logDelta: fit.logDelta };
    this.cache.set(competition, { params, expiresAt: now + this.CACHE_DURATION_MS });
    return params;
  }

  /**
   * Prediction traçable pour un match a venir, combinant Elo (pour eloDiff)
   * et les parametres Ordered Logit ajustes sur l'historique de la
   * competition. Retourne null si l'une des deux equipes n'a pas
   * d'historique Elo, ou si l'historique de la competition est insuffisant.
   */
  async predictMatch(
    competition: string,
    homeTeam: string,
    awayTeam: string,
  ): Promise<OrderedLogitPredictionExplained | null> {
    const eloRatings = await this.eloRatingService.getRatings(competition);
    const homeState = eloRatings.get(homeTeam);
    const awayState = eloRatings.get(awayTeam);

    if (!homeState || !awayState) {
      this.logger.warn(`ordered_logit indisponible pour ${homeTeam} vs ${awayTeam} (${competition}) : Elo inconnu`);
      return null;
    }

    const params = await this.getParams(competition);
    if (!params) {
      return null;
    }

    const eloDiff = (homeState.rating - awayState.rating) / 400;
    return this.orderedLogitService.predict(homeTeam, awayTeam, eloDiff, params);
  }
}
