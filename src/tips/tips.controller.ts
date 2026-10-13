import { Controller, Get, Query } from '@nestjs/common';
import { TipsService } from './tips.service';

@Controller('tips')
export class TipsController {
  constructor(private readonly tips: TipsService) {}

  @Get()
  getTips(@Query('min') min?: string, @Query('days') days?: string) {
    const m = Number(min);
    const d = Number(days);
    return this.tips.getTips(
      min && !isNaN(m) ? m : 0.6,
      days && !isNaN(d) ? d : 7,
    );
  }
}
