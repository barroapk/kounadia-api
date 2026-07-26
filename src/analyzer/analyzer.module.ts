import { Module } from '@nestjs/common';
import { AnalyzerController } from './analyzer.controller';
import { AnalyzerService } from './analyzer.service';
import { SportsDataModule } from '../sports-data/sports-data.module';
import { ApiFootballModule } from '../api-football/api-football.module';
import { TeamFormModule } from '../team-form/team-form.module';

@Module({
  imports: [SportsDataModule, ApiFootballModule, TeamFormModule],
  controllers: [AnalyzerController],
  providers: [AnalyzerService],
})
export class AnalyzerModule {}
