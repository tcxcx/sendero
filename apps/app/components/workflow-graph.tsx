'use client';

import { useMemo } from 'react';

import type { Edge as FlowEdge, Node as FlowNode } from '@xyflow/react';

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
      className="w-[280px] border-[color:var(--border)] bg-[color:var(--panel)] shadow-none"
      handles={{ source: true, target: true }}
    >
      <NodeHeader className="bg-[color:var(--bg-soft)]">
        <NodeTitle className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink)]">
          {data.label}
        </NodeTitle>
        <NodeDescription className="mt-1 text-xs text-[color:var(--text-dim)]">
          {data.description}
        </NodeDescription>
      </NodeHeader>
      <NodeContent className="grid gap-2 bg-[color:var(--panel)] text-xs text-[color:var(--text)]">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-faint)]">
            Status
          </span>
          <span
            className="rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em]"
            style={{
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
      <NodeFooter className="flex items-center justify-between bg-[color:var(--bg-soft)] font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-faint)]">
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

  if (nodes.length === 0) return null;

  return (
    <div
      style={{
        borderBottom: '1px solid var(--border)',
        height: 260,
      }}
    >
      <Canvas
        className="bg-[color:var(--panel)]"
        edgeTypes={edgeTypes}
        edges={edges}
        elementsSelectable={false}
        fitView
        maxZoom={1.25}
        minZoom={0.5}
        nodeTypes={nodeTypes}
        nodes={nodes}
        nodesConnectable={false}
        nodesDraggable={false}
      >
        <Controls />
        <Panel position="top-left">
          <div className="px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--text-faint)]">
            Sendero workflow map
          </div>
        </Panel>
      </Canvas>
    </div>
  );
}
