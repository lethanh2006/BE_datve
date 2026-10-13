import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException } from '../common/exception/api.exception';
import { PageResponse } from '../common/response/page-response';
import { EventResponse } from './dto/event.response';
import { Event } from './event.entity';

@Injectable()
export class EventService {
  constructor(
    @InjectRepository(Event) private readonly repo: Repository<Event>,
  ) {}

  async findAll(
    page: number,
    size: number,
  ): Promise<PageResponse<EventResponse>> {
    const [rows, total] = await this.repo.findAndCount({
      order: { id: 'ASC' },
      skip: page * size,
      take: size,
    });
    return PageResponse.of(rows.map(EventResponse.from), page, size, total);
  }

  async findById(id: number): Promise<EventResponse> {
    const event = await this.repo.findOneBy({ id: String(id) });
    if (!event) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'EVENT_NOT_FOUND',
        `Không tìm thấy sự kiện có id ${id}`,
      );
    }
    return EventResponse.from(event);
  }

  exists(id: number): Promise<boolean> {
    return this.repo.existsBy({ id: String(id) });
  }
}
