import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** A data table set like a magazine listing: a thick ink rule under the header, hairlines and zebra rhythm below. */
export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-small", className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("sticky top-0 z-10 bg-sheet", className)} {...props} />;
}

export const TableBody = (props: HTMLAttributes<HTMLTableSectionElement>) => <tbody {...props} />;

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("border-b border-hairline last:border-b-0 even:bg-newsprint/60", className)} {...props} />;
}

export function TableHead({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={cn("h-11 border-b-[3px] border-ink px-3 text-left align-bottom text-small font-bold whitespace-nowrap text-ink", className)} {...props} />
  );
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-3 py-3 align-top", className)} {...props} />;
}
