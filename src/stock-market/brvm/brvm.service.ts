import { Inject, Injectable } from '@nestjs/common';
import { BRVM_DATA_PROVIDER } from './brvm-data.constants';
import { BrvmCatalog } from './brvm.types';
import type { BrvmDataProvider } from './brvm.types';

@Injectable()
export class BrvmService {
  private cachedCatalog: { data: BrvmCatalog; expiresAt: number } | null = null;
  private readonly CACHE_DURATION_MS = 15 * 60 * 1000; // 15 min, aligné sur la fréquence de mise à jour de la source.

  constructor(
    @Inject(BRVM_DATA_PROVIDER)
    private readonly provider: BrvmDataProvider,
  ) {}

  async getCatalog(): Promise<BrvmCatalog> {
    const now = Date.now();
    if (this.cachedCatalog && this.cachedCatalog.expiresAt > now) {
      return this.cachedCatalog.data;
    }

    const catalog = await this.provider.getCatalog();
    this.cachedCatalog = { data: catalog, expiresAt: now + this.CACHE_DURATION_MS };
    return catalog;
  }
}
