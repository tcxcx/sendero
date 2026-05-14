"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";

type ColumnId = string;
type CardId = string;

export interface KanbanRootProps<T> {
  columns: Record<ColumnId, T[]>;
  getItemValue: (item: T) => CardId;
  onMove: (params: {
    cardId: CardId;
    fromColumn: ColumnId;
    toColumn: ColumnId;
    toIndex: number;
  }) => void;
  renderOverlay?: (card: T) => ReactNode;
  children: ReactNode;
  className?: string;
}

export function KanbanRoot<T>({
  columns,
  getItemValue,
  onMove,
  renderOverlay,
  children,
  className,
}: KanbanRootProps<T>) {
  const [activeCard, setActiveCard] = useState<T | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const findCard = (
    cardId: CardId,
  ): { card: T; column: ColumnId; index: number } | null => {
    for (const [column, cards] of Object.entries(columns)) {
      const index = cards.findIndex((c) => getItemValue(c) === cardId);
      if (index !== -1) return { card: cards[index] as T, column, index };
    }
    return null;
  };

  const onDragStart = (event: DragStartEvent) => {
    const found = findCard(String(event.active.id));
    setActiveCard(found?.card ?? null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    setActiveCard(null);
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    const source = findCard(activeId);
    if (!source) return;

    let toColumn = source.column;
    let toIndex = source.index;

    const overAsCard = findCard(overId);
    if (overAsCard) {
      toColumn = overAsCard.column;
      toIndex = overAsCard.index;
      if (source.column === toColumn && source.index < toIndex) toIndex -= 1;
    } else if (overId in columns) {
      toColumn = overId;
      toIndex = columns[overId]?.length ?? 0;
    } else {
      return;
    }

    if (toColumn === source.column && toIndex === source.index) return;

    onMove({ cardId: activeId, fromColumn: source.column, toColumn, toIndex });
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div
        className={cn(
          "flex w-full items-start gap-4 overflow-x-auto pb-2",
          className,
        )}
      >
        {children}
      </div>
      <DragOverlay>
        {activeCard && renderOverlay ? renderOverlay(activeCard) : null}
      </DragOverlay>
    </DndContext>
  );
}

interface KanbanColumnProps {
  id: ColumnId;
  title: string;
  count: number;
  accent?: "default" | "success" | "warning" | "danger";
  children: ReactNode;
  className?: string;
}

export function KanbanColumn({
  id,
  title,
  count,
  accent = "default",
  children,
  className,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const accentBar =
    accent === "success"
      ? "border-l-emerald-500"
      : accent === "warning"
        ? "border-l-amber-400"
        : accent === "danger"
          ? "border-l-rose-500"
          : "border-l-violet-500";

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-[320px] shrink-0 flex-col gap-3 rounded-xl border bg-card p-3 shadow-sm",
        "border-l-4",
        accentBar,
        isOver && "ring-2 ring-violet-500/40",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border bg-muted px-1.5 text-[11px] font-semibold tabular-nums">
          {count}
        </span>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

interface KanbanItemProps {
  id: CardId;
  children: ReactNode;
  className?: string;
}

export function KanbanItem({ id, children, className }: KanbanItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "cursor-grab touch-none rounded-lg border bg-background p-3 shadow-sm transition active:cursor-grabbing",
        isDragging && "opacity-40",
        className,
      )}
    >
      {children}
    </div>
  );
}

interface KanbanSortableContextProps {
  items: CardId[];
  children: ReactNode;
}

export function KanbanSortableContext({
  items,
  children,
}: KanbanSortableContextProps) {
  return (
    <SortableContext items={items} strategy={verticalListSortingStrategy}>
      {children}
    </SortableContext>
  );
}
