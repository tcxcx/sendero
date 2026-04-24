export default function GlassDebugPage() {
  return (
    <div className="app-shell-root flex h-svh w-full flex-col">
      <div className="flex min-h-0 w-full flex-1">
        <div
          className="group peer hidden text-sidebar-foreground md:block"
          data-collapsible=""
          data-side="left"
          data-state="expanded"
          data-variant="sidebar"
        >
          <div className="relative w-[260px] bg-transparent" />
          <div className="fixed inset-y-0 left-0 z-10 hidden h-svh w-[260px] md:flex">
            <div className="flex h-full w-full flex-col bg-sidebar" data-sidebar="sidebar">
              <div className="px-4 py-5">
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  Workspace
                </p>
                <p className="mb-5 text-sm font-medium">Tomas&apos;s Organization</p>
                <div className="grid gap-1 text-sm">
                  <div className="rounded-md bg-[color:var(--tint-vermillion-soft)] px-3 py-2 text-[color:var(--ink)]">
                    Home
                  </div>
                  <div className="px-3 py-2">Agent console</div>
                  <div className="px-3 py-2">Trip inboxes</div>
                  <div className="px-3 py-2">Trips</div>
                </div>
              </div>
              <div className="mt-auto border-t border-[color:var(--border)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.12em]">
                LLMS.TXT
              </div>
            </div>
          </div>
        </div>

        <main
          className="relative my-3 mr-3 flex min-h-0 w-full flex-1 flex-col rounded-bl-[20px] rounded-br-[20px] rounded-tl-[36px] rounded-tr-[20px] border-2 bg-[color:var(--surface-raised)] shadow-[var(--shadow-xl)]"
          style={{
            borderColor: 'color-mix(in oklab, var(--ink) 55%, transparent)',
            marginLeft: 260,
          }}
        >
          <div className="flex h-14 items-start justify-between px-6 pt-3">
            <p className="text-xs text-muted-foreground">Glass debug — public, no auth</p>
          </div>
          <section className="p-8">
            <h1 className="text-3xl font-semibold tracking-[-0.01em]">Glass shell</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Sidebar and footer should show the topography pattern through blurred glass.
            </p>
            <div className="mt-8 rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-white/70 p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Reference content
              </p>
              <p className="mt-1 text-sm font-medium">Raised app card beside the glass sidebar.</p>
            </div>
          </section>
        </main>
      </div>

      <div className="app-shell-footer shrink-0 bg-transparent">
        <div className="footer-rail">
          <span>CIRCLE · ARC L2 · BLOCK #38819331 · GAS 20.0001 GWEI</span>
          <span>TREASURY 0XFC95…6B58 · BALANCE 16.8 USDC</span>
        </div>
      </div>
    </div>
  );
}
