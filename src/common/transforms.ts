/** Cắt khoảng trắng hai đầu; chuỗi rỗng coi như không gửi (undefined). */
export const trimToUndefined = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

export const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const trimLowercase = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export const trimUppercaseEach = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value.map((v: unknown) =>
        typeof v === 'string' ? v.trim().toUpperCase() : v,
      )
    : value;
