import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { BrvmCatalog, BrvmDataProvider } from './brvm.types';

@Injectable()
export class GitHubBrvmProvider implements BrvmDataProvider {
  private readonly metadataUrl =
    'https://raw.githubusercontent.com/Fredysessie/brvm-data-public/main/data/metadata.json';

  constructor(private readonly http: HttpService) {}

  async getCatalog(): Promise<BrvmCatalog> {
    const response = await firstValueFrom(
      this.http.get(this.metadataUrl),
    );

    const data = response.data;

    if (!data || !Array.isArray(data.tickers_list)) {
      throw new Error('Format metadata BRVM invalide : tickers_list manquant');
    }

    if (!Array.isArray(data.indexes_list)) {
      throw new Error('Format metadata BRVM invalide : indexes_list manquant');
    }

    const companies = data.tickers_list
      .filter((ticker: unknown): ticker is string => typeof ticker === 'string')
      .map((ticker: string) => ({
        ticker: ticker.trim(),
      }))
      .filter((company) => company.ticker.length > 0);

    const indexes = data.indexes_list
      .filter((index: unknown): index is string => typeof index === 'string')
      .map((index: string) => index.trim())
      .filter((index: string) => index.length > 0);

    return {
      companies,
      indexes,
      lastUpdated:
        typeof data.last_updated === 'string'
          ? data.last_updated
          : null,
    };
  }
}
