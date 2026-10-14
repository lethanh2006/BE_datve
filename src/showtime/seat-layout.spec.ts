import { ApiException } from '../common/exception/api.exception';
import { SeatSectionRequest } from './dto/seat-section.request';
import { buildSeats, MAX_SEATS_PER_SHOWTIME } from './seat-layout';

const section = (
  over: Partial<SeatSectionRequest> = {},
): SeatSectionRequest => ({
  category: 'STANDARD',
  rows: ['A'],
  seatsPerRow: 3,
  faceValue: 100000,
  ...over,
});

describe('buildSeats', () => {
  it('sinh mã ghế theo hàng rồi số thứ tự', () => {
    const seats = buildSeats([section({ rows: ['A', 'B'], seatsPerRow: 2 })]);
    expect(seats.map((s) => s.seatCode)).toEqual(['A1', 'A2', 'B1', 'B2']);
    expect(seats[0]).toEqual({
      seatCode: 'A1',
      category: 'STANDARD',
      faceValue: 100000,
    });
  });

  it('gộp nhiều khu với hạng và giá riêng', () => {
    const seats = buildSeats([
      section({
        category: 'VIP',
        rows: ['A'],
        seatsPerRow: 1,
        faceValue: 500000,
      }),
      section({ rows: ['B'], seatsPerRow: 1 }),
    ]);
    expect(seats.map((s) => [s.seatCode, s.category, s.faceValue])).toEqual([
      ['A1', 'VIP', 500000],
      ['B1', 'STANDARD', 100000],
    ]);
  });

  it('báo lỗi khi trùng mã ghế giữa các khu', () => {
    expect(() => buildSeats([section(), section({ category: 'VIP' })])).toThrow(
      ApiException,
    );
    try {
      buildSeats([section(), section()]);
    } catch (e) {
      expect((e as ApiException).code).toBe('DUPLICATE_SEAT_CODE');
    }
  });

  it('báo lỗi khi vượt giới hạn số ghế', () => {
    const rows = Array.from({ length: 26 }, (_, i) =>
      String.fromCharCode(65 + i),
    );
    expect(rows.length * 100).toBeGreaterThan(MAX_SEATS_PER_SHOWTIME);
    expect(() => buildSeats([section({ rows, seatsPerRow: 100 })])).toThrow(
      /tối đa/,
    );
  });

  it('danh sách rỗng cho ra không có ghế', () => {
    expect(buildSeats([])).toEqual([]);
  });
});
