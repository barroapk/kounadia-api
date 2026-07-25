import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { FootballDataProvider } from './football-data.provider';
import { SPORTS_DATA_PROVIDER } from './sports-data.constants';

@Module({
  imports: [HttpModule],
  providers: [
    {
      provide: SPORTS_DATA_PROVIDER,
      useClass: FootballDataProvider,
    },
  ],
  exports: [SPORTS_DATA_PROVIDER],
})
export class SportsDataModule {}
