import type { Meta, StoryObj } from '@storybook/react';
import { Alert, AlertDescription, AlertTitle } from '../components/alert';
import { Badge } from '../components/badge';
import { Button } from '../components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/card';
import { Checkbox } from '../components/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/dropdown-menu';
import { Form, FormControl, FormField, FormItem, FormLabel } from '../components/form';
import { Input } from '../components/input';
import { Label } from '../components/label';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/select';
import { Separator } from '../components/separator';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '../components/sheet';
import { Skeleton } from '../components/skeleton';
import { Toaster } from '../components/sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/tabs';
import { Textarea } from '../components/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/tooltip';
import { useForm } from 'react-hook-form';

const meta = {
  title: 'UI/Primitives',
  parameters: { layout: 'centered' },
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const ButtonPrimitive: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Button>Default</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Destructive</Button>
    </div>
  ),
};

export const FormInputsPrimitive: Story = {
  render: () => <InputSet />,
};

export const SelectCheckboxPrimitive: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-4">
      <Select defaultValue="business">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="free">Free</SelectItem>
          <SelectItem value="business">Business</SelectItem>
          <SelectItem value="enterprise">Enterprise</SelectItem>
        </SelectContent>
      </Select>
      <div className="flex items-center gap-2">
        <Checkbox id="checked" defaultChecked />
        <Label htmlFor="checked">Require approval</Label>
      </div>
    </div>
  ),
};

export const CardBadgeAlertPrimitive: Story = {
  render: () => (
    <Card className="w-96">
      <CardHeader>
        <CardTitle>Invoice ready</CardTitle>
        <CardDescription>
          <Badge>paid</Badge>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Alert>
          <AlertTitle>Settlement complete</AlertTitle>
          <AlertDescription>Funds landed on Arc and the PDF is ready.</AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  ),
};

export const DialogSheetPrimitive: Story = {
  render: () => (
    <div className="flex gap-2">
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline">Dialog</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm booking</DialogTitle>
            <DialogDescription>Review the fare before reserving funds.</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
      <Sheet>
        <SheetTrigger asChild>
          <Button>Sheet</Button>
        </SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Prefund trip</SheetTitle>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    </div>
  ),
};

export const TabsSkeletonSeparatorPrimitive: Story = {
  render: () => (
    <Tabs defaultValue="trips" className="w-96">
      <TabsList>
        <TabsTrigger value="trips">Trips</TabsTrigger>
        <TabsTrigger value="invoices">Invoices</TabsTrigger>
      </TabsList>
      <TabsContent value="trips" className="flex flex-col gap-3">
        <Skeleton className="h-8 w-full" />
        <Separator />
        <Skeleton className="h-8 w-2/3" />
      </TabsContent>
      <TabsContent value="invoices">No invoices.</TabsContent>
    </Tabs>
  ),
};

export const MenuPopoverTooltipPrimitive: Story = {
  render: () => (
    <TooltipProvider>
      <div className="flex gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">Menu</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Download</DropdownMenuItem>
            <DropdownMenuItem>Void</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">Popover</Button>
          </PopoverTrigger>
          <PopoverContent>Arc settlement details</PopoverContent>
        </Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button>Tooltip</Button>
          </TooltipTrigger>
          <TooltipContent>Secure buyer action</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  ),
};

export const TablePrimitive: Story = {
  render: () => (
    <Table className="w-[520px]">
      <TableHeader>
        <TableRow>
          <TableHead>Trip</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>NYC to SFO</TableCell>
          <TableCell>booked</TableCell>
          <TableCell>$1,248.00</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
};

export const SonnerPrimitive: Story = {
  render: () => <Toaster />,
};

function InputSet() {
  const form = useForm({ defaultValues: { email: 'traveler@example.com' } });
  return (
    <Form {...form}>
      <form className="flex w-80 flex-col gap-4">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
            </FormItem>
          )}
        />
        <div className="flex flex-col gap-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" placeholder="Policy note" />
        </div>
      </form>
    </Form>
  );
}
