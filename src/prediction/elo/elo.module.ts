import { Module } from '@nestjs/common';
import { EloService } from './elo.service';
import { EloRatingService } from './elo-rating.service';
import { EloController } from './elo.controller';
import { SupabaseModule } from '../../supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  controllers: [EloController],
  providers: [EloService, EloRatingService],
  exports: [EloService, EloRatingService],
})
export class EloModule {}
