import { Module } from '@nestjs/common';
import { StandingsController } from './standings.controller';
import { StandingsService } from './standings.service';
import { SportsDataModule } from '../sports-data/sports-data.module';

@Module({
  imports: [SportsDataModule],
  controllers: [StandingsController],
  providers: [StandingsService],
})
export class StandingsModule {}
