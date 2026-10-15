import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
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
import { EloModule } from './elo/elo.module';
import { OrderedLogitModule } from './prediction/ordered-logit/ordered-logit.module';
import { ExtraCompetitionsModule } from './extra-competitions/extra-competitions.module';
import { StandingsModule } from './standings/standings.module';
import { CalendarModule } from './calendar/calendar.module';
import { TipsModule } from './tips/tips.module';
import { ScoregptModule } from './scoregpt/scoregpt.module';
import { NerdytipsModule } from './nerdytips/nerdytips.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true }),
    SupabaseModule,
    LeaguesModule,
    MatchesModule,
    AnalyzerModule,
    ApiFootballModule,
    TeamFormModule,
    PredictionsModule,
    EloModule,
    OrderedLogitModule,
    ExtraCompetitionsModule,
    StandingsModule,
    CalendarModule,
    TipsModule,
    ScoregptModule,
    NerdytipsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
