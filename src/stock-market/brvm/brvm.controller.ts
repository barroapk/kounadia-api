import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { BrvmService } from './brvm.service';

@Controller('stocks/brvm')
export class BrvmController {
  constructor(private readonly brvmService: BrvmService) {}

  @Get()
  async getCatalog() {
    return this.brvmService.getCatalog();
  }

  @Get(':ticker')
  async getQuote(@Param('ticker') ticker: string) {
    const quote = await this.brvmService.getQuote(ticker);
    if (!quote) {
      throw new NotFoundException({ message: 'Action BRVM introuvable', ticker: ticker.toUpperCase() });
    }
    return quote;
  }

  @Get(':ticker/history')
  async getHistory(@Param('ticker') ticker: string) {
    const history = await this.brvmService.getHistory(ticker);
    if (history.length === 0) {
      throw new NotFoundException({ message: 'Action BRVM introuvable', ticker: ticker.toUpperCase() });
    }
    return { ticker: ticker.toUpperCase(), candles: history };
  }
}
