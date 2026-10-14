import {
  HttpStatus,
  Injectable,
  Logger,
  MessageEvent,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { Client } from 'pg';
import {
  debounceTime,
  interval,
  map,
  merge,
  Observable,
  of,
  Subject,
  takeUntil,
} from 'rxjs';
import { DataSource } from 'typeorm';
import { ApiException } from '../common/exception/api.exception';

const CHANNEL = 'seat_changes';
/** Gửi tín hiệu định kỳ để proxy/trình duyệt không đóng kết nối rảnh. */
const HEARTBEAT_MS = 25_000;
/** Gộp nhiều thay đổi dồn dập (ví dụ đặt 10 ghế) thành một sự kiện. */
const DEBOUNCE_MS = 150;
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;

/**
 * Phát sự kiện "ghế của suất diễn X vừa đổi" tới các client đang mở luồng SSE.
 *
 * Nguồn sự kiện là trigger trong DB (V6) + LISTEN/NOTIFY của PostgreSQL nên mọi thay đổi đều được báo,
 * dù do request nào, job nền hay một instance khác của API gây ra. Một kết nối LISTEN riêng cho cả tiến trình.
 * Mất kết nối DB thì tự nối lại, rồi báo mọi client tải lại vì có thể đã lỡ thông báo trong lúc mất kết nối.
 */
@Injectable()
export class SeatEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SeatEventsService.name);
  private readonly listeners = new Map<number, Set<() => void>>();
  private readonly destroy$ = new Subject<void>();
  private readonly maxClients: number;
  private client: Client | null = null;
  private clientCount = 0;
  private stopped = false;
  private everConnected = false;
  private retryTimer: NodeJS.Timeout | null = null;
  private retryDelay = RETRY_MIN_MS;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    this.maxClients = Number(config.get('SEAT_STREAM_MAX_CLIENTS', 5000));
  }

  onModuleInit() {
    void this.connect();
  }

  async onModuleDestroy() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    // Kết thúc mọi luồng SSE để server tắt được mà không chờ client tự ngắt
    this.destroy$.next();
    this.destroy$.complete();
    const client = this.client;
    this.client = null;
    client?.removeAllListeners();
    void client?.end().catch(() => undefined);
    // Chờ các response SSE kịp kết thúc và socket chuyển sang rảnh; nếu không, server.close() sẽ chờ
    // tới hết keep-alive timeout (5 giây) mới tắt được.
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  /** Luồng SSE cho một suất diễn: `ready` ngay khi nối, `seats` mỗi khi ghế đổi, `ping` định kỳ. */
  subscribe(showtimeId: number): Observable<MessageEvent> {
    if (this.clientCount >= this.maxClients) {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'STREAM_BUSY',
        'Hệ thống đang có quá nhiều kết nối theo dõi ghế, vui lòng thử lại sau',
      );
    }

    return new Observable<MessageEvent>((subscriber) => {
      const changes = new Subject<void>();
      const listener = () => changes.next();
      let set = this.listeners.get(showtimeId);
      if (!set) this.listeners.set(showtimeId, (set = new Set()));
      set.add(listener);
      this.clientCount++;

      const subscription = merge(
        of<MessageEvent>({ type: 'ready', data: { showtimeId } }),
        changes.pipe(
          debounceTime(DEBOUNCE_MS),
          map((): MessageEvent => ({ type: 'seats', data: { showtimeId } })),
        ),
        interval(HEARTBEAT_MS).pipe(
          map((): MessageEvent => ({ type: 'ping', data: {} })),
        ),
      )
        .pipe(takeUntil(this.destroy$))
        .subscribe(subscriber);

      return () => {
        subscription.unsubscribe();
        changes.complete();
        set.delete(listener);
        if (set.size === 0 && this.listeners.get(showtimeId) === set)
          this.listeners.delete(showtimeId);
        this.clientCount--;
      };
    });
  }

  private dispatch(showtimeId: number) {
    this.listeners.get(showtimeId)?.forEach((notify) => notify());
  }

  private dispatchAll() {
    this.listeners.forEach((set) => set.forEach((notify) => notify()));
  }

  private async connect() {
    if (this.stopped) return;
    const o = this.dataSource.options as {
      host?: string;
      port?: number;
      username?: string;
      password?: unknown;
      database?: string;
    };
    const client = new Client({
      host: o.host,
      port: o.port,
      user: o.username,
      password: typeof o.password === 'string' ? o.password : undefined,
      database: o.database,
    });
    client.on('notification', (msg) => {
      if (msg.channel === CHANNEL && msg.payload)
        this.dispatch(Number(msg.payload));
    });
    client.on('error', (error) => {
      this.logger.warn(`Kết nối LISTEN bị lỗi: ${error.message}`);
      this.lost(client);
    });
    client.on('end', () => this.lost(client));

    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
      if (this.stopped) {
        client.removeAllListeners();
        await client.end();
        return;
      }
      this.client = client;
      this.retryDelay = RETRY_MIN_MS;
      // Có thể đã lỡ thông báo trong lúc mất kết nối nên bảo mọi client tải lại
      if (this.everConnected) this.dispatchAll();
      this.everConnected = true;
    } catch (error) {
      this.logger.warn(
        `Chưa nối được LISTEN ${CHANNEL}: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.lost(client);
    }
  }

  private lost(client: Client) {
    client.removeAllListeners();
    void client.end().catch(() => undefined);
    if (this.client === client) this.client = null;
    if (this.stopped || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS);
  }
}
