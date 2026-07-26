import { Module } from '@nestjs/common';
import { PredictionsController } from './predictions.controller';
import { PredictionsService } from './predictions.service';
import { MatchesModule } from '../matches/matches.module';
import { TeamFormModule } from '../team-form/team-form.module';
import { EloModule } from '../elo/elo.module';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [MatchesModule, TeamFormModule, EloModule, SupabaseModule],
  controllers: [PredictionsController],
  providers: [PredictionsService],
})
export class PredictionsModule {}
