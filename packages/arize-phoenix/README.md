# @sendero/arize-phoenix

Arize Phoenix observability for Sendero. Single package importing `@arizeai/*` and the Phoenix OTLP exporter; all surfaces import from here.

**Spec:** `docs/specs/arize-phoenix-integration.md`.

## Two-plane observability

| Plane | Package | Purpose |
|---|---|---|
| Human ops | `@sendero/langfuse` | Prompt management, evaluators, golden-turn regression, operator dashboards |
| Agent runtime | `@sendero/arize-phoenix` (this) | Agent self-introspection — `recall_similar_turns`, `find_resolved_gap` (PR2/PR3) |

Both consume the same OTel spans via separate processors on a single `NodeTracerProvider`. Spec §4.1.

## PR1 status (this PR)

- ✅ Package skeleton + OTLP HTTP exporter
- ✅ `buildPhoenixSpanProcessor()` for orchestrator-time provider construction
- ✅ Sendero-specific span attrs (`sendero.tenant_id`, etc.) stamped by `traceAgent`
- ✅ Self-host fallback via `docker-compose.yml`
- ⏳ PR2 — `recall_similar_turns` tool (read side via `@arizeai/phoenix-client`)
- ⏳ PR3 — `find_resolved_gap` + self-healing loop
- ⏳ PR4 — auto-curation crons

## Env

```
PHOENIX_API_KEY="ak_..."                                 # bearer for OTLP + REST
PHOENIX_BASE_URL="https://app.phoenix.arize.com"         # cloud default
PHOENIX_COLLECTOR_ENDPOINT="https://app.phoenix.arize.com/s/<workspace>"
PHOENIX_PROJECT_NAME="sendero"                           # space/project routing
PHOENIX_ENABLED="false"                                  # force-off override (optional)
```

## Self-host (demo fallback)

```bash
cd packages/arize-phoenix
docker compose up -d
# UI at http://localhost:6006
```

Then in `.env.local`:
```
PHOENIX_COLLECTOR_ENDPOINT="http://localhost:6006"
unset PHOENIX_API_KEY  # self-host doesn't require auth
```
