import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { BrvmService } from './brvm.service';
import { BrvmIndicatorsService } from './brvm-indicators.service';

@Controller('stocks/brvm')
export class BrvmController {
  constructor(
    private readonly brvmService: BrvmService,
    private readonly indicatorsService: BrvmIndicatorsService,
  ) {}

  @Get()
  async getCatalog() {
    return this.brvmService.getCatalog();
  }

  @Get('quotes')
  async getAllQuotes() {
    return { quotes: await this.brvmService.getAllQuotes() };
  }

  @Get('indices')
  async getIndices() {
    return { indices: await this.brvmService.getIndexQuotes() };
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

  @Get(':ticker/indicators')
  async getIndicators(@Param('ticker') ticker: string) {
    const history = await this.brvmService.getHistory(ticker);
    if (history.length === 0) {
      throw new NotFoundException({ message: 'Action BRVM introuvable', ticker: ticker.toUpperCase() });
    }

    return {
      ticker: ticker.toUpperCase(),
      lastDataDate: history[history.length - 1].date,
      sma20: this.indicatorsService.computeSma(history, 20),
      sma50: this.indicatorsService.computeSma(history, 50),
      rsi14: this.indicatorsService.computeRsi(history, 14),
      volatility20: this.indicatorsService.computeVolatility(history, 20),
      maxDrawdown: this.indicatorsService.computeMaxDrawdown(history),
    };
  }
}
