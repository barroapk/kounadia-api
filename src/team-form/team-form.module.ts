import { Module } from '@nestjs/common';
import { TeamFormService } from './team-form.service';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  providers: [TeamFormService],
  exports: [TeamFormService],
})
export class TeamFormModule {}
