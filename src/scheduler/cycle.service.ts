import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfig, type FeedConfig } from '../config/index.js';
import { DiscordService } from '../discord/index.js';
import { FetcherService } from '../fetcher/index.js';
import { type FeedItem, ParserService } from '../parser/index.js';
import { StoreService } from '../store/index.js';
import {
  CYCLE_OPTIONS,
  type CycleOptions,
  type CycleReport,
  type FeedReport,
} from './cycle.types.js';

/**
 * One poll cycle: for each feed, in turn,
 *   fetch -> parse -> keep unseen items -> post oldest first -> mark as seen.
 *
 * Rules that keep "each item exactly once" true:
 * - First run of a feed = silent seed: current items are recorded, not posted.
 * - An item is marked as seen only after Discord accepted it.
 * - If a post fails, the feed stops there; later items wait, so the channel
 *   keeps chronological order.
 * - The new ETag / Last-Modified is saved only once every new item is
 *   posted. Otherwise the next fetch could get a 304 and the waiting items
 *   would never be seen again.
 * - One failing feed never stops the others.
 */
@Injectable()
export class CycleService {
  private readonly logger = new Logger(CycleService.name);
  private current?: Promise<CycleReport>;
  private stopping = false;

  constructor(
    private readonly config: AppConfig,
    private readonly fetcher: FetcherService,
    private readonly parser: ParserService,
    private readonly store: StoreService,
    private readonly discord: DiscordService,
    @Inject(CYCLE_OPTIONS) private readonly options: CycleOptions,
  ) {}

  get isRunning(): boolean {
    return this.current !== undefined;
  }

  /**
   * Runs a cycle. If one is already running, returns that one instead of
   * starting a second (the lock: two cycles could post the same item twice).
   */
  run(): Promise<CycleReport> {
    if (!this.current) {
      this.current = this.runAllFeeds().finally(() => {
        this.current = undefined;
      });
    }
    return this.current;
  }

  /** Asks the running cycle to stop after its current post (shutdown). */
  stop(): void {
    this.stopping = true;
  }

  /** Resolves when no cycle is running. */
  async idle(): Promise<void> {
    await this.current?.catch(() => undefined);
  }

  private async runAllFeeds(): Promise<CycleReport> {
    const startedAt = new Date();
    const feeds: FeedReport[] = [];

    for (const feed of this.config.feeds) {
      if (this.stopping) break;
      feeds.push(await this.runFeed(feed));
    }

    const report: CycleReport = {
      startedAt,
      durationMs: Date.now() - startedAt.getTime(),
      feeds,
      ok: feeds.every((feed) => feed.status !== 'failed'),
    };
    this.logReport(report);
    return report;
  }

  private async runFeed(feed: FeedConfig): Promise<FeedReport> {
    try {
      return await this.processFeed(feed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        feedId: feed.id,
        status: 'failed',
        posted: 0,
        pending: 0,
        error: message,
      };
    }
  }

  private async processFeed(feed: FeedConfig): Promise<FeedReport> {
    const result = await this.fetcher.fetch(
      feed.url,
      this.store.getValidators(feed.id),
    );
    if (result.status === 'not-modified') {
      return { feedId: feed.id, status: 'not-modified', posted: 0, pending: 0 };
    }

    const { items, skipped } = this.parser.parse(result.body, feed.url);
    if (skipped > 0) {
      this.logger.warn(
        `feed ${feed.id}: ${skipped} item(s) without id or link skipped`,
      );
    }

    if (!this.store.hasBeenSeeded(feed.id)) {
      this.store.seed(
        feed.id,
        items.map((item) => item.id),
      );
      this.store.saveValidators(feed.id, result.validators);
      this.logger.log(
        `feed ${feed.id}: first run, ${items.length} existing item(s) recorded, nothing posted`,
      );
      return { feedId: feed.id, status: 'seeded', posted: 0, pending: 0 };
    }

    const unseen = new Set(
      this.store.unseenIds(
        feed.id,
        items.map((item) => item.id),
      ),
    );
    const fresh = oldestFirst(items.filter((item) => unseen.has(item.id)));
    const batch = fresh.slice(0, this.options.maxPostsPerFeed);

    let posted = 0;
    for (const item of batch) {
      if (this.stopping) break;
      try {
        await this.discord.post(feed, item);
      } catch (error) {
        // Validators not saved: the next cycle fetches the full feed again.
        return {
          feedId: feed.id,
          status: 'failed',
          posted,
          pending: fresh.length - posted,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      this.store.markSeen(feed.id, [item.id]);
      posted++;
    }

    const pending = fresh.length - posted;
    if (pending === 0) this.store.saveValidators(feed.id, result.validators);

    return {
      feedId: feed.id,
      status: posted > 0 ? 'posted' : 'up-to-date',
      posted,
      pending,
    };
  }

  private logReport(report: CycleReport): void {
    const parts = report.feeds.map((feed) => {
      const pending = feed.pending > 0 ? `, ${feed.pending} waiting` : '';
      return feed.status === 'posted'
        ? `${feed.feedId} posted ${feed.posted}${pending}`
        : `${feed.feedId} ${feed.status}${pending}`;
    });
    const summary = `cycle done in ${report.durationMs} ms: ${parts.join(', ') || 'no feed'}`;
    if (report.ok) {
      this.logger.log(summary);
    } else {
      this.logger.warn(summary);
      for (const feed of report.feeds) {
        if (feed.error) this.logger.error(`feed ${feed.feedId}: ${feed.error}`);
      }
    }
  }
}

/**
 * Oldest first, so the channel reads in order. Items with a date are sorted
 * by it; feeds list newest first, so undated items keep the reversed order.
 */
function oldestFirst(items: readonly FeedItem[]): FeedItem[] {
  return [...items]
    .reverse()
    .map((item, index) => ({ item, index }))
    .sort((a, b) =>
      a.item.date && b.item.date
        ? a.item.date.getTime() - b.item.date.getTime() || a.index - b.index
        : a.index - b.index,
    )
    .map(({ item }) => item);
}
