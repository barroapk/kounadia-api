import { Module } from '@nestjs/common';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';
import { SportsDataModule } from '../sports-data/sports-data.module';

@Module({
  imports: [SportsDataModule],
  controllers: [MatchesController],
  providers: [MatchesService],
})
export class MatchesModule {}
