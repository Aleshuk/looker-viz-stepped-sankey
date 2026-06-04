# Stepped Funnel Sankey — Looker custom visualization

A stepped / funnel-style Sankey (waterfall path flow) for Looker. Each dimension is an ordered
step; distinct values are nodes sized by a measure; ribbons between consecutive steps are sized
by shared volume, with retention percentages vs. the first step and small nodes bucketed into
"Other".

Validate locally with `test/harness.html` (synthetic data). Capture a synthetic-data
screenshot as `example.png` for this README before publishing — _never commit customer
data_ (see `SECURITY.md`).

Three **input modes** (option "Input Mode"):
- **stepped** — N dimensions (each an ordered step) + 1 measure. Funnel with retention/drop-off.
- **edges** — 2 dimensions (source, target) + 1 measure. Edge-list flow graph (longest-path layout).
- **pathfinder** — 3 dimensions (entity, order, event). Amplitude-style: builds each entity's
  ordered path itself (pick start event, max steps, collapse repeats) — no pre-pivot model.

- **Stack:** single vanilla-JS + SVG IIFE, no dependencies, no build step.
- **Deploy:** see [`DEPLOY.md`](DEPLOY.md) (GitHub → jsdelivr → Looker Admin).
- **Validate locally:** open [`test/harness.html`](test/harness.html) (synthetic data only — _never commit real data_, see `SECURITY.md`).

Built for Jira **DBI-5310** (delegation lifecycle funnel / Sankey / Pathfinder).
