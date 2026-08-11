'use client';

export default function PanelPagination({ page, pageCount, total, label, onPage }: {
  page: number;
  pageCount: number;
  total: number;
  label: string;
  onPage: (page: number) => void;
}) {
  return (
    <div className="dashboard-list-pagination">
      <span>{total} {label}</span>
      <div>
        <button type="button" aria-label={`${label} sebelumnya`} disabled={page <= 1} onClick={() => onPage(Math.max(1, page - 1))}>←</button>
        <span>{page}/{pageCount}</span>
        <button type="button" aria-label={`${label} berikutnya`} disabled={page >= pageCount} onClick={() => onPage(Math.min(pageCount, page + 1))}>→</button>
      </div>
    </div>
  );
}
