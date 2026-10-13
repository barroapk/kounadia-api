import { Controller, Get } from '@nestjs/common';
import { ScoregptService } from './scoregpt.service';

@Controller('scoregpt')
export class ScoregptController {
  constructor(private readonly sg: ScoregptService) {}

  @Get('today')
  today() {
    return this.sg.getToday();
  }

  @Get('results')
  results() {
    return this.sg.getResults();
  }
}
