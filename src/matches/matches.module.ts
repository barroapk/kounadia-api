import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MatchesController } from './matches.controller';
import { MatchesSyncController } from './matches-sync.controller';
import { SeasonImportController } from './season-import.controller';
import { MatchesService } from './matches.service';
import { MatchesSyncService } from './matches-sync.service';
import { SeasonImportService } from './season-import.service';
import { SportsDataModule } from '../sports-data/sports-data.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { ApiFootballModule } from '../api-football/api-football.module';

@Module({
  imports: [SportsDataModule, SupabaseModule, HttpModule, ApiFootballModule],
  controllers: [MatchesController, MatchesSyncController, SeasonImportController],
  providers: [MatchesService, MatchesSyncService, SeasonImportService],
  exports: [MatchesService],
})
export class MatchesModule {}
