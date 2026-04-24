import { Button } from '@sendero/ui/button';
import { Input } from '@sendero/ui/input';
import { Label } from '@sendero/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@sendero/ui/select';

export function InvoiceFilters({
  status,
  kind,
  period,
}: {
  status?: string;
  kind?: string;
  period?: string;
}) {
  return (
    <form className="mb-4 grid gap-3 rounded-[var(--radius-lg)] bg-white p-4 shadow-[var(--shadow-sm)] md:grid-cols-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="status">Status</Label>
        <Select name="status" defaultValue={status ?? 'all'}>
          <SelectTrigger id="status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="issued">Issued</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="viewed">Viewed</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="kind">Kind</Label>
        <Select name="kind" defaultValue={kind ?? 'all'}>
          <SelectTrigger id="kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="booking">Booking</SelectItem>
            <SelectItem value="platform_bill">Platform bill</SelectItem>
            <SelectItem value="credit_note">Credit note</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="period">Period</Label>
        <Select name="period" defaultValue={period ?? 'all'}>
          <SelectTrigger id="period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="this_month">This month</SelectItem>
            <SelectItem value="last_month">Last month</SelectItem>
            <SelectItem value="ytd">YTD</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col justify-end gap-2">
        <Input type="hidden" name="page" value="1" readOnly />
        <Button type="submit">Apply filters</Button>
      </div>
    </form>
  );
}
