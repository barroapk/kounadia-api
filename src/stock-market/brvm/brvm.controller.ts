import { Controller, Get } from '@nestjs/common';
import { BrvmService } from './brvm.service';

@Controller('stocks/brvm')
export class BrvmController {
  constructor(private readonly brvmService: BrvmService) {}

  @Get()
  async getCatalog() {
    return this.brvmService.getCatalog();
  }
}
