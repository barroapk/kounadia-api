import { Module } from '@nestjs/common';
import { OrderedLogitService } from './ordered-logit.service';
import { OrderedLogitRatingService } from './ordered-logit-rating.service';
import { OrderedLogitController } from './ordered-logit.controller';
import { SupabaseModule } from '../../supabase/supabase.module';
import { EloModule } from '../elo/elo.module';

@Module({
  imports: [SupabaseModule, EloModule],
  controllers: [OrderedLogitController],
  providers: [OrderedLogitService, OrderedLogitRatingService],
  exports: [OrderedLogitService, OrderedLogitRatingService],
})
export class OrderedLogitModule {}
