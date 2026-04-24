import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@sendero/ui/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        // Sendero "topography" CTA. Outline at rest; on hover, the
        // vermilion topography pattern fills in from the bottom-left
        // and a "selection rectangle" wraps the label in white-on-ink.
        // Pair the children with <span> elements named below or use the
        // <TopographyButton> wrapper for the full markup.
        topography:
          'agent-console-cta border border-[color:color-mix(in_oklab,var(--ink)_22%,transparent)] bg-[color:var(--bg-elev)] text-[color:var(--text)] hover:text-[color:#fff]',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  }
);
Button.displayName = 'Button';

/**
 * TopographyButton — convenience wrapper that renders the two `<span>`
 * children the `topography` variant needs (background mask layer +
 * label that gets the selection-rectangle on hover). Use anywhere a
 * standard `<Button variant="topography">` would go but you don't want
 * to manage the inner spans.
 */
const TopographyButton = React.forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, 'variant'> & { children: React.ReactNode }
>(({ className, size, asChild = false, children, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      className={cn(buttonVariants({ variant: 'topography', size, className }))}
      ref={ref}
      {...props}
    >
      <span className="agent-console-cta__bg" aria-hidden="true" />
      <span className="agent-console-cta__label">{children}</span>
    </Comp>
  );
});
TopographyButton.displayName = 'TopographyButton';

export { Button, TopographyButton, buttonVariants };
