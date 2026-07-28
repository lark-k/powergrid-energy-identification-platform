import { useMemo, useState } from "react";
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from "@tanstack/react-table";
import { CaretDown, CaretUp } from "@phosphor-icons/react";

export type DataRow = Record<string, string | number>;
export function VirtualDataTable({ data, columns }: { data: DataRow[]; columns: ColumnDef<DataRow>[] }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [scrollTop, setScrollTop] = useState(0);
  const table = useReactTable({ data, columns, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel() });
  const rows = table.getRowModel().rows; const rowHeight = 34; const viewport = 270; const overscan = 8;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(rows.length, start + Math.ceil(viewport / rowHeight) + overscan * 2);
  const visible = useMemo(() => rows.slice(start, end), [rows, start, end]);
  return <div className="virtual-table">
    <div className="table-head">{table.getHeaderGroups()[0].headers.map((header) => <button key={header.id} onClick={header.column.getToggleSortingHandler()} style={{ width: `${header.getSize()}px` }}>
      {flexRender(header.column.columnDef.header, header.getContext())}{header.column.getIsSorted() === "asc" ? <CaretUp /> : header.column.getIsSorted() === "desc" ? <CaretDown /> : null}</button>)}</div>
    <div className="table-scroll" style={{ height: viewport }} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
      <div style={{ height: rows.length * rowHeight, position: "relative" }}>{visible.map((row, index) => <div className="table-row" key={row.id} style={{ height: rowHeight, transform: `translateY(${(start + index) * rowHeight}px)` }}>
        {row.getVisibleCells().map((cell) => <span key={cell.id} style={{ width: `${cell.column.getSize()}px` }}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</span>)}</div>)}</div>
    </div>
  </div>;
}
