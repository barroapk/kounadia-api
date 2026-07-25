import { Inject, Injectable, Logger } from '@nestjs/common';
import { SPORTS_DATA_PROVIDER } from '../sports-data/sports-data.constants';
import type { SportsDataProvider } from '../sports-data/sports-data-provider.interface';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class MatchesSyncService {
  private readonly logger = new Logger(MatchesSyncService.name);

  constructor(
    @Inject(SPORTS_DATA_PROVIDER)
    private sportsDataProvider: SportsDataProvider,
    private supabase: SupabaseService,
  ) {}

  async syncFinishedMatches(days: number): Promise<{
    success: boolean;
    checked: number;
    imported: number;
    message: string;
  }> {
    const matches = await this.sportsDataProvider.getRecentFinishedMatches(days);

    if (matches.length === 0) {
      this.logger.log('Aucun match terminé trouvé sur cette période');
      return {
        success: true,
        checked: 0,
        imported: 0,
        message: 'Aucun match terminé trouvé.',
      };
    }

    const rows = matches.map((m) => ({
      id: m.id,
      competition: m.competition,
      home_team: m.homeTeam,
      away_team: m.awayTeam,
      home_score: m.homeScore,
      away_score: m.awayScore,
      status: m.status,
      utc_date: m.utcDate,
    }));

    const { error } = await this.supabase.client
      .from('match_history')
      .upsert(rows, { onConflict: 'id' });

    if (error) {
      this.logger.error('Erreur de synchronisation', error);
      throw error;
    }

    this.logger.log(`${rows.length} match(s) synchronisé(s) sur ${days} jour(s)`);
    return {
      success: true,
      checked: matches.length,
      imported: rows.length,
      message: 'Synchronisation terminée.',
    };
  }
}
