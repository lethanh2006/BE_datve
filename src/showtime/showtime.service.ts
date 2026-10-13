import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException } from '../common/exception/api.exception';
import { EventService } from '../event/event.service';
import { ShowtimeResponse } from './dto/showtime.response';
import { Showtime } from './showtime.entity';

@Injectable()
export class ShowtimeService {
  constructor(
    @InjectRepository(Showtime) private readonly repo: Repository<Showtime>,
    private readonly eventService: EventService,
  ) {}

  async findByEventId(eventId: number): Promise<ShowtimeResponse[]> {
    if (!(await this.eventService.exists(eventId))) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'EVENT_NOT_FOUND',
        `Không tìm thấy sự kiện có id ${eventId}`,
      );
    }
    const rows = await this.repo.find({
      where: { eventId: String(eventId) },
      order: { startTime: 'ASC' },
    });
    return rows.map(ShowtimeResponse.from);
  }

  exists(id: number): Promise<boolean> {
    return this.repo.existsBy({ id: String(id) });
  }
}
