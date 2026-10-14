export class EventResponse {
  id: number;
  name: string;
  description: string | null;
  venue: string;
  imageUrl: string | null;
  category: string | null;
  /** Giờ bắt đầu của suất diễn sắp tới gần nhất (null nếu chưa có) */
  nextShowtime: Date | null;
  /** Giá vé thấp nhất trong các suất sắp tới (null nếu chưa có) */
  minPrice: number | null;
}
