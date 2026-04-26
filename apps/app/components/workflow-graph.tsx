'use client';

import { useMemo, useState } from 'react';

import type { Edge as FlowEdge, Node as FlowNode } from '@xyflow/react';
import { Maximize2, Minimize2 } from 'lucide-react';

import { Canvas } from '@/components/ai-elements/canvas';
import { Controls } from '@/components/ai-elements/controls';
import { Edge } from '@/components/ai-elements/edge';
import {
  Node,
  NodeContent,
  NodeDescription,
  NodeFooter,
  NodeHeader,
  NodeTitle,
} from '@/components/ai-elements/node';
import { Panel } from '@/components/ai-elements/panel';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

interface WorkflowEvent {
  id: string;
  group: string;
  bullet: 'done' | 'active' | 'fail' | 'pending';
  text: string;
  t: string;
}

interface WorkflowGraphProps {
  workflow: WorkflowEvent[];
}

interface WorkflowNodeData extends Record<string, unknown> {
  count: number;
  description: string;
  label: string;
  latestAt: string;
  status: WorkflowEvent['bullet'];
}

function stripHtml(text: string) {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function statusLabel(status: WorkflowEvent['bullet']) {
  if (status === 'done') return 'Done';
  if (status === 'active') return 'Running';
  if (status === 'fail') return 'Error';
  return 'Queued';
}

const nodeTypes = {
  workflow: ({ data }: { data: WorkflowNodeData }) => (
    <Node
      className="w-[280px] rounded-none border-[color:var(--border)] bg-[color:var(--bg-elev)] shadow-none"
      handles={{ source: true, target: true }}
    >
      <NodeHeader className="rounded-none border-[color:var(--border)] bg-[color:var(--bg-sunk)]">
        <NodeTitle className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink)]">
          {data.label}
        </NodeTitle>
        <NodeDescription className="mt-1 text-xs text-[color:var(--text-dim)]">
          {data.description}
        </NodeDescription>
      </NodeHeader>
      <NodeContent className="grid gap-2 bg-[color:var(--bg-elev)] text-xs text-[color:var(--text)]">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-faint)]">
            Status
          </span>
          <span
            className="border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em]"
            style={{
              borderColor:
                data.status === 'done'
                  ? 'color-mix(in oklab, var(--accent-green) 40%, var(--border))'
                  : data.status === 'fail'
                    ? 'color-mix(in oklab, var(--accent-rose) 40%, var(--border))'
                    : 'var(--ink)',
              color:
                data.status === 'done'
                  ? 'var(--accent-green)'
                  : data.status === 'fail'
                    ? 'var(--accent-rose)'
                    : 'var(--ink)',
            }}
          >
            {statusLabel(data.status)}
          </span>
        </div>
      </NodeContent>
      <NodeFooter className="flex items-center justify-between rounded-none border-[color:var(--border)] bg-[color:var(--bg-sunk)] font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-faint)]">
        <span>{data.count} evt</span>
        <span>{data.latestAt}</span>
      </NodeFooter>
    </Node>
  ),
};

const edgeTypes = {
  animated: Edge.Animated,
  temporary: Edge.Temporary,
};

export function WorkflowGraph({ workflow }: WorkflowGraphProps) {
  const groups = useMemo(() => {
    const ordered: Array<{ group: string; events: WorkflowEvent[] }> = [];
    const seen = new Map<string, { group: string; events: WorkflowEvent[] }>();

    for (const event of workflow) {
      const existing = seen.get(event.group);
      if (existing) {
        existing.events.push(event);
        continue;
      }
      const next = { group: event.group, events: [event] };
      seen.set(event.group, next);
      ordered.push(next);
    }

    return ordered;
  }, [workflow]);

  const nodes = useMemo<FlowNode<WorkflowNodeData>[]>(() => {
    return groups.map((group, index) => {
      const latest = group.events[group.events.length - 1];
      return {
        data: {
          count: group.events.length,
          description: stripHtml(latest.text),
          label: group.group,
          latestAt: latest.t,
          status: latest.bullet,
        },
        id: group.group,
        position: {
          x: index * 340,
          y: index % 2 === 0 ? 0 : 100,
        },
        type: 'workflow',
      };
    });
  }, [groups]);

  const edges = useMemo<FlowEdge[]>(() => {
    return groups.slice(1).map((group, index) => {
      const latest = group.events[group.events.length - 1];
      return {
        id: `${groups[index].group}-${group.group}`,
        source: groups[index].group,
        target: group.group,
        type: latest.bullet === 'fail' ? 'temporary' : 'animated',
      };
    });
  }, [groups]);

  const [expanded, setExpanded] = useState(false);

  if (nodes.length === 0) return null;

  // Same Canvas renders inline (260px) and in the fullscreen Dialog. Keying
  // the Canvas on `expanded` forces ReactFlow to remount + recompute fitView
  // for the new viewport size — without it the dialog opens with a tiny
  // pre-zoomed graph stuck at the inline dimensions.
  const renderCanvas = (variant: 'inline' | 'dialog') => (
    <Canvas
      key={variant}
      className="bg-[color:var(--bg)]"
      edgeTypes={edgeTypes}
      edges={edges}
      elementsSelectable={false}
      fitView
      maxZoom={1.5}
      minZoom={0.3}
      nodeTypes={nodeTypes}
      nodes={nodes}
      nodesConnectable={variant === 'dialog' ? false : false}
      nodesDraggable={variant === 'dialog'}
    >
      <Controls className="rounded-none border-[color:var(--border)] bg-[color:var(--bg-elev)] [&>button]:text-[color:var(--text)] [&_svg]:fill-[color:var(--text)]" />
      <Panel
        className="rounded-none border-[color:var(--border)] bg-[color:var(--bg-elev)] flex items-center gap-2"
        position="top-left"
      >
        <span className="px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--text-faint)]">
          Sendero workflow map
        </span>
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          aria-label={variant === 'dialog' ? 'Collapse workflow map' : 'Expand workflow map'}
          title={variant === 'dialog' ? 'Collapse' : 'Expand to full screen'}
          className="grid h-6 w-6 place-items-center border-0 bg-transparent text-[color:var(--text-dim)] hover:text-[color:var(--ink)] cursor-pointer"
        >
          {variant === 'dialog' ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
        </button>
      </Panel>
    </Canvas>
  );

  return (
    <>
      <div
        style={{
          borderBottom: '1px solid var(--border)',
          height: 260,
        }}
      >
        {renderCanvas('inline')}
      </div>

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          className="flex flex-col gap-0 p-0 overflow-hidden"
          style={{
            width: 'min(100vw, 1440px)',
            maxWidth: 'calc(100vw - 48px)',
            height: 'calc(100vh - 64px)',
            maxHeight: 'calc(100vh - 64px)',
            background: 'var(--bg, #fdfbf7)',
            borderRadius: 12,
          }}
        >
          <DialogTitle className="sr-only">Sendero workflow map</DialogTitle>
          <div style={{ flex: 1, minHeight: 0 }}>{renderCanvas('dialog')}</div>
        </DialogContent>
      </Dialog>
    </>
  );
}
