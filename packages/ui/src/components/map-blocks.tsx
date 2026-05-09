'use client';

import { Activity, MapPin, Navigation, Radio, Route } from 'lucide-react';

import { Badge } from './badge';
import { Card, CardContent, CardHeader, CardTitle } from './card';

export type SenderoMapPoint = {
  id: string;
  label: string;
  description?: string | null;
  latitude: number;
  longitude: number;
  metric?: string | number | null;
  status?: 'active' | 'pending' | 'attention' | 'quiet';
  href?: string | null;
};

export type SenderoMapRoute = {
  id: string;
  label: string;
  from: SenderoMapPoint;
  to: SenderoMapPoint;
  status?: 'active' | 'pending' | 'attention' | 'quiet';
  detail?: string | null;
  href?: string | null;
};

type MapSummary = {
  label: string;
  value: string | number;
};

type ActiveUsersMapProps = {
  title: string;
  description?: string;
  points: SenderoMapPoint[];
  routes?: SenderoMapRoute[];
  summaries?: MapSummary[];
  emptyTitle?: string;
  emptyDescription?: string;
};

const inkHairline = 'color-mix(in oklab, var(--ink, #fb542b) 18%, transparent)';
const inkHairlineStrong = 'color-mix(in oklab, var(--ink, #fb542b) 28%, transparent)';
const surfaceRaised = 'var(--surface-raised, var(--card))';
const width = 960;
const height = 420;

function project(point: SenderoMapPoint): { x: number; y: number } {
  return {
    x: ((point.longitude + 180) / 360) * width,
    y: ((90 - point.latitude) / 180) * height,
  };
}

function statusColor(status: SenderoMapPoint['status']) {
  if (status === 'attention') return 'var(--destructive, #ef4444)';
  if (status === 'pending') return 'var(--muted-foreground, #737373)';
  if (status === 'quiet')
    return 'color-mix(in oklab, var(--muted-foreground, #737373) 55%, transparent)';
  return 'var(--primary, #fb542b)';
}

function routeColor(status: SenderoMapRoute['status']) {
  if (status === 'attention') return 'var(--destructive, #ef4444)';
  if (status === 'pending') return 'var(--muted-foreground, #737373)';
  if (status === 'quiet')
    return 'color-mix(in oklab, var(--muted-foreground, #737373) 70%, transparent)';
  return 'var(--primary, #fb542b)';
}

function arcPath(route: SenderoMapRoute): string {
  const from = project(route.from);
  const to = project(route.to);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lift = Math.max(34, Math.min(118, Math.hypot(dx, dy) * 0.22));
  const cx = from.x + dx / 2;
  const cy = from.y + dy / 2 - lift;
  return `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`;
}

function EmptyMap({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex h-[420px] flex-col items-center justify-center gap-2 p-8 text-center">
      <MapPin className="h-5 w-5 text-muted-foreground" />
      <div className="font-medium">{title}</div>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function RouteCanvas({ points, routes }: { points: SenderoMapPoint[]; routes: SenderoMapRoute[] }) {
  return (
    <div className="relative h-[420px] overflow-hidden bg-[radial-gradient(circle_at_1px_1px,color-mix(in_oklab,var(--ink,#fb542b)_18%,transparent)_1px,transparent_0)] [background-size:18px_18px]">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label="Trip route map"
      >
        <rect
          width={width}
          height={height}
          fill="color-mix(in oklab, var(--surface, #fff) 94%, transparent)"
        />
        <path
          d="M70 216 C158 170 260 196 348 154 C456 102 548 128 648 112 C750 96 812 148 898 116"
          fill="none"
          stroke={inkHairline}
          strokeWidth="1.25"
          strokeDasharray="4 8"
        />
        <path
          d="M102 308 C220 288 346 330 466 292 C592 252 724 288 870 244"
          fill="none"
          stroke={inkHairline}
          strokeWidth="1.25"
          strokeDasharray="4 8"
        />
        {routes.map(route => (
          <path
            key={route.id}
            d={arcPath(route)}
            fill="none"
            stroke={routeColor(route.status)}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        ))}
        {points.map(point => {
          const p = project(point);
          return (
            <g key={point.id}>
              <circle
                cx={p.x}
                cy={p.y}
                r="10"
                fill="var(--background, #fff)"
                stroke={inkHairlineStrong}
              />
              <circle cx={p.x} cy={p.y} r="5" fill={statusColor(point.status)} />
            </g>
          );
        })}
      </svg>
      <div className="absolute bottom-3 left-3 right-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {points.slice(0, 6).map(point => (
          <a
            key={point.id}
            href={point.href ?? undefined}
            className="rounded-md border bg-background/92 p-2 text-xs shadow-sm backdrop-blur"
            style={{ borderColor: inkHairlineStrong }}
          >
            <div className="font-medium">{point.label}</div>
            {point.description ? (
              <div className="mt-0.5 truncate text-muted-foreground">{point.description}</div>
            ) : null}
          </a>
        ))}
      </div>
    </div>
  );
}

export function ActiveUsersMap({
  title,
  description,
  points,
  routes = [],
  summaries = [],
  emptyTitle = 'No active map data',
  emptyDescription = 'Once rows include location signals, this map will render them here.',
}: ActiveUsersMapProps) {
  return (
    <Card
      className="overflow-hidden p-0 shadow-sm"
      style={{ borderColor: inkHairlineStrong, background: surfaceRaised }}
    >
      <CardHeader className="border-b px-4 py-3" style={{ borderColor: inkHairline }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Radio className="h-4 w-4" />
              {title}
            </CardTitle>
            {description ? (
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {summaries.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {summaries.map(item => (
                <Badge key={item.label} variant="secondary" className="gap-1">
                  <span className="font-mono">{item.value}</span>
                  {item.label}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {points.length === 0 ? (
          <EmptyMap title={emptyTitle} description={emptyDescription} />
        ) : (
          <RouteCanvas points={points} routes={routes} />
        )}
      </CardContent>
    </Card>
  );
}

export function DeliveryProgressMap({
  title,
  route,
  progressLabel,
}: {
  title: string;
  route: SenderoMapRoute | null;
  progressLabel?: string;
}) {
  return (
    <Card
      className="overflow-hidden p-0 shadow-sm"
      style={{ borderColor: inkHairlineStrong, background: surfaceRaised }}
    >
      <CardHeader className="border-b px-4 py-3" style={{ borderColor: inkHairline }}>
        <CardTitle className="flex items-center gap-2 text-base">
          <Navigation className="h-4 w-4" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-0 p-0 lg:grid-cols-[280px_1fr]">
        <aside
          className="border-b p-4 lg:border-r lg:border-b-0"
          style={{ borderColor: inkHairline }}
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <Route className="h-4 w-4" />
            {route?.label ?? 'Route pending'}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {progressLabel ??
              route?.detail ??
              'Live route state appears here once the trip has route metadata.'}
          </p>
          <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            <Activity className="h-3.5 w-3.5" />
            Active trip route and settlement state.
          </div>
        </aside>
        {route ? (
          <RouteCanvas points={[route.from, route.to]} routes={[route]} />
        ) : (
          <EmptyMap
            title="No route geography yet"
            description="This trip needs origin and destination country metadata before the route can render."
          />
        )}
      </CardContent>
    </Card>
  );
}
