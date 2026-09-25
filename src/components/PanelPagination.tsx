'use client';

export default function PanelPagination({ page, pageCount, total, pageSize=15, label, onPage }: {
  page: number;
  pageCount: number;
  total: number;
  pageSize?: number;
  label: string;
  onPage: (page: number) => void;
}) {
  const start = total ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(total, page * pageSize);
  return (
    <div className="dashboard-list-pagination">
      <span>{start}–{end} dari {total} {label}</span>
      <div>
        <button type="button" aria-label={`Halaman pertama ${label}`} disabled={page <= 1} onClick={() => onPage(1)}>«</button>
        <button type="button" aria-label={`${label} sebelumnya`} disabled={page <= 1} onClick={() => onPage(Math.max(1, page - 1))}>←</button>
        <span>Halaman {page} dari {pageCount}</span>
        <button type="button" aria-label={`${label} berikutnya`} disabled={page >= pageCount} onClick={() => onPage(Math.min(pageCount, page + 1))}>→</button>
        <button type="button" aria-label={`Halaman terakhir ${label}`} disabled={page >= pageCount} onClick={() => onPage(pageCount)}>»</button>
      </div>
    </div>
  );
}
