import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SupabaseModule } from './supabase/supabase.module';
import { LeaguesModule } from './leagues/leagues.module';
import { MatchesModule } from './matches/matches.module';
import { AnalyzerModule } from './analyzer/analyzer.module';
import { ApiFootballModule } from './api-football/api-football.module';
import { TeamFormModule } from './team-form/team-form.module';
import { PredictionsModule } from './predictions/predictions.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SupabaseModule,
    LeaguesModule,
    MatchesModule,
    AnalyzerModule,
    ApiFootballModule,
    TeamFormModule,
    PredictionsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
