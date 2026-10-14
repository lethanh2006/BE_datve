/** Thoát ký tự đặc biệt của LIKE để từ khoá `%`, `_`, `\` được hiểu là chữ thường. */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Mẫu LIKE "chứa từ khoá" từ chuỗi người dùng nhập, hoặc null nếu để trống. */
export const containsPattern = (q: string | undefined | null) =>
  q ? `%${escapeLike(q)}%` : null;

/**
 * Điều kiện SQL "cột chứa từ khoá" không phân biệt hoa thường và dấu (cần extension unaccent, V8).
 * `column` và `param` chỉ nhận các giá trị do code viết sẵn (tên cột, số thứ tự tham số), không bao giờ là dữ liệu người dùng.
 */
export const matches = (column: string, param: string) =>
  `unaccent(${column}) ILIKE unaccent(${param})`;
