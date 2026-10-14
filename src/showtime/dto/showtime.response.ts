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
  /** Thời điểm suất diễn bị huỷ, null nếu vẫn diễn ra */
  cancelledAt: Date | null;
  cancelReason: string | null;
}
