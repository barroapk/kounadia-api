import { Module } from '@nestjs/common';
import { MatchesController } from './matches.controller';
import { MatchesSyncController } from './matches-sync.controller';
import { MatchesService } from './matches.service';
import { MatchesSyncService } from './matches-sync.service';
import { SportsDataModule } from '../sports-data/sports-data.module';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [SportsDataModule, SupabaseModule],
  controllers: [MatchesController, MatchesSyncController],
  providers: [MatchesService, MatchesSyncService],
})
export class MatchesModule {}
