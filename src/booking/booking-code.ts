/** Mã đơn hiển thị cho người dùng: DV-000123 (cùng quy ước với frontend). */
export const bookingCode = (id: number | string) =>
  `DV-${String(id).padStart(6, '0')}`;
