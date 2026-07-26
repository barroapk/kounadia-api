import { Module } from '@nestjs/common';
import { PredictionsController } from './predictions.controller';
import { PredictionsService } from './predictions.service';
import { MatchesModule } from '../matches/matches.module';
import { TeamFormModule } from '../team-form/team-form.module';

@Module({
  imports: [MatchesModule, TeamFormModule],
  controllers: [PredictionsController],
  providers: [PredictionsService],
})
export class PredictionsModule {}
