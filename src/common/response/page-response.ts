export class PageResponse<T> {
  constructor(
    public content: T[],
    public page: number,
    public size: number,
    public totalElements: number,
    public totalPages: number,
  ) {}

  static of<T>(
    content: T[],
    page: number,
    size: number,
    totalElements: number,
  ): PageResponse<T> {
    return new PageResponse(
      content,
      page,
      size,
      totalElements,
      Math.ceil(totalElements / size),
    );
  }
}
