import { Module } from '@nestjs/common';
import { EloService } from './elo.service';
import { EloController } from './elo.controller';
import { BacktestService } from './backtest.service';
import { BacktestController } from './backtest.controller';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  controllers: [EloController, BacktestController],
  providers: [EloService, BacktestService],
  exports: [EloService],
})
export class EloModule {}
