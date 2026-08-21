import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BrvmLiveService } from './brvm-live.service';

@Injectable()
export class BrvmLiveScheduler {
  private readonly logger = new Logger(BrvmLiveScheduler.name);

  constructor(
    private readonly brvmLiveService: BrvmLiveService,
  ) {}

  /**
   * Rafraîchissement automatique toutes les minutes.
   *
   * Le service BrvmLiveService possède déjà son propre verrou :
   * plusieurs appels simultanés ne déclencheront pas plusieurs
   * requêtes vers la BRVM.
   */
  @Cron('* * * * *')
  async refreshBrvmCache(): Promise<void> {
    try {
      const quotes = await this.brvmLiveService.refreshNow();

      this.logger.log(
        `Cache BRVM automatique : ${quotes.length} cotations`,
      );
    } catch (error) {
      this.logger.warn(
        `Rafraîchissement BRVM automatique impossible : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
