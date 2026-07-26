import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { SupabaseService } from '../supabase/supabase.service';
import { COMPETITIONS } from '../config/competitions';

@Injectable()
export class SeasonImportService {
  private readonly logger = new Logger(SeasonImportService.name);
  private readonly baseUrl = 'https://api.football-data.org/v4';

  constructor(
    private http: HttpService,
    private config: ConfigService,
    private supabase: SupabaseService,
  ) {}

  private get headers() {
    return { 'X-Auth-Token': this.config.get<string>('FOOTBALL_DATA_API_KEY') };
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async importSeason(
    season: number,
  ): Promise<{ competition: string; imported: number }[]> {
    const results: { competition: string; imported: number }[] = [];
    const activeCompetitions = COMPETITIONS.filter((c) => c.enabled);

    for (const { code } of activeCompetitions) {
      try {
        const response = await firstValueFrom(
          this.http.get(
            `${this.baseUrl}/competitions/${code}/matches?season=${season}&status=FINISHED`,
            { headers: this.headers },
          ),
        );

        const matches = response.data.matches;

        if (matches.length > 0) {
          const rows = matches.map((m: any) => ({
            id: m.id,
            competition: m.competition?.name ?? code,
            home_team: m.homeTeam?.name ?? '',
            away_team: m.awayTeam?.name ?? '',
            home_score: m.score?.fullTime?.home ?? null,
            away_score: m.score?.fullTime?.away ?? null,
            status: m.status,
            utc_date: m.utcDate,
          }));

          const { error } = await this.supabase.client
            .from('match_history')
            .upsert(rows, { onConflict: 'id' });

          if (error) throw error;
        }

        results.push({ competition: code, imported: matches.length });
        this.logger.log(`${code} (saison ${season}) : ${matches.length} matchs importés`);
      } catch (error) {
        this.logger.error(`Échec pour ${code} (saison ${season}): ${error.message}`);
        results.push({ competition: code, imported: 0 });
      }

      await this.sleep(8000);
    }

    return results;
  }
}
