import { Controller, Get } from '@nestjs/common';
import { NerdytipsService } from './nerdytips.service';

@Controller('nerdytips')
export class NerdytipsController {
  constructor(private readonly nt: NerdytipsService) {}

  @Get('today')
  today() {
    return this.nt.getToday();
  }

  @Get('results')
  results() {
    return this.nt.getResults();
  }
}
