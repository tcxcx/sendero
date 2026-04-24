import type { ReactNode } from 'react';

import type { ReactFlowProps } from '@xyflow/react';
import { Background, ReactFlow } from '@xyflow/react';

import '@xyflow/react/dist/style.css';

type CanvasProps = ReactFlowProps & {
  children?: ReactNode;
};

const deleteKeyCode = ['Backspace', 'Delete'];

export const Canvas = ({ children, ...props }: CanvasProps) => (
  <ReactFlow
    deleteKeyCode={deleteKeyCode}
    fitView
    panOnDrag={false}
    panOnScroll
    selectionOnDrag={true}
    zoomOnDoubleClick={false}
    {...props}
  >
    <Background bgColor="var(--bg)" color="var(--border)" gap={20} size={1} />
    {children}
  </ReactFlow>
);
