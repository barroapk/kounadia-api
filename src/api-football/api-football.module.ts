import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ApiFootballService } from './api-football.service';
import { ApiFootballController } from './api-football.controller';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [HttpModule, SupabaseModule],
  controllers: [ApiFootballController],
  providers: [ApiFootballService],
  exports: [ApiFootballService],
})
export class ApiFootballModule {}
