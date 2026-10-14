export class ShowtimeResponse {
  id: number;
  eventId: number;
  startTime: Date;
  endTime: Date;
  totalSeats: number;
  /** Số ghế chưa bị giữ hoặc bán tại thời điểm truy vấn */
  availableSeats: number;
  /** Giá vé thấp nhất (null nếu suất chưa có ghế) */
  minPrice: number | null;
}
