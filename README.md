# Stepped Funnel Sankey — Looker custom visualization

A stepped / funnel-style Sankey (waterfall path flow) for Looker. Each dimension is an ordered
step; distinct values are nodes sized by a measure; ribbons between consecutive steps are sized
by shared volume, with retention percentages vs. the first step and small nodes bucketed into
"Other".

Validate locally with `test/harness.html` (synthetic data). Capture a synthetic-data
screenshot as `example.png` for this README before publishing — _never commit customer
data_ (see `SECURITY.md`).

- **Input:** ≥ 2 dimensions (steps, in order) + 1 measure (flow weight).
- **Stack:** single vanilla-JS + SVG IIFE, no dependencies, no build step.
- **Deploy:** see [`DEPLOY.md`](DEPLOY.md) (GitHub → jsdelivr → Looker Admin).
- **Validate locally:** open [`test/harness.html`](test/harness.html).

Built for Jira **DBI-5310**. Default production-flow mapping:
`order_status → product_category → production_status → print_house_name`, weight = item count.
