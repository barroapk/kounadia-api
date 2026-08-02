import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { StandingsController } from './standings.controller';
import { StandingsService } from './standings.service';
import { SportsDataModule } from '../sports-data/sports-data.module';
import { ApiFootballModule } from '../api-football/api-football.module';

@Module({
  imports: [SportsDataModule, HttpModule, ApiFootballModule],
  controllers: [StandingsController],
  providers: [StandingsService],
})
export class StandingsModule {}
