import { Button } from '@sendero/ui/button';
import { Checkbox } from '@sendero/ui/checkbox';
import { Input } from '@sendero/ui/input';
import { Label } from '@sendero/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@sendero/ui/select';
import { upsertCapAction } from '@/app/(app)/dashboard/caps/actions';

export function CapsForm() {
  return (
    <form
      action={upsertCapAction}
      className="grid gap-4 rounded-[var(--radius-lg)] bg-white p-6 shadow-[var(--shadow-md)]"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="period">Period</Label>
          <Select name="period" defaultValue="daily">
            <SelectTrigger id="period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="amountUsdc">Amount (USDC)</Label>
          <Input
            id="amountUsdc"
            name="amountUsdc"
            defaultValue="10.00"
            pattern="\d+(\.\d{1,6})?"
            required
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Checkbox id="hardCap" name="hardCap" defaultChecked />
        <Label htmlFor="hardCap">Hard cap blocks further calls</Label>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="alertWebhookUrl">Alert webhook</Label>
        <Input
          id="alertWebhookUrl"
          name="alertWebhookUrl"
          type="url"
          placeholder="https://hooks.example.com/cap-breach"
        />
      </div>
      <Button type="submit" className="w-fit">
        Save cap
      </Button>
    </form>
  );
}
