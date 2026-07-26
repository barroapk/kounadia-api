import { Module } from '@nestjs/common';
import { EloService } from './elo.service';
import { EloController } from './elo.controller';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  controllers: [EloController],
  providers: [EloService],
  exports: [EloService],
})
export class EloModule {}
