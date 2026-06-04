# Deploy — Stepped Funnel Sankey (Looker custom visualization)

A single-file vanilla-JS + SVG custom viz. No build step: the file you commit is the file
Looker fetches and runs. Hosted on a **public GitHub repo**, served via the **jsdelivr CDN**,
registered in **Looker Admin → Platform → Visualizations**.

> Jira: DBI-5310 · Built following the "Build your own Looker custom visualization" playbook.

---

## Input contract

| Input | Requirement |
|---|---|
| Dimensions | **≥ 2**, in order. Each dimension is a step/column. |
| Measure | **exactly 1** — the flow weight (e.g. item count). |

Production-flow default mapping (DBI-5310):
`order_status → product_category → production_status → print_house_name`, measure = item count.

The viz aggregates the measure per node (distinct dimension value at a step) and per flow
(rows sharing values across two consecutive steps). Nodes below the **Bucket %** of their step
total are merged into **"Other"**.

---

## 1. Host on GitHub (clean, public)

```bash
cd looker-viz-stepped-sankey
git init
git add stepped_sankey.js DEPLOY.md SECURITY.md README.md .gitignore example.png
git commit -m "init: stepped funnel sankey custom viz (DBI-5310)"
git branch -M main
git remote add origin git@github.com:Aleshuk/looker-viz-stepped-sankey.git
git push -u origin main
```

Push only a clean tree — **no customer data** in files, screenshots, or commit messages
(`example.png` must be synthetic). See `SECURITY.md` and apply ALL repo settings before push.

## 2. jsdelivr URL

```
https://cdn.jsdelivr.net/gh/Aleshuk/looker-viz-stepped-sankey@<sha>/stepped_sankey.js
```

- `@main` — latest, cached ~12h. Use while iterating.
- `@<commit_sha>` — immutable. **Use this in production.**

Force-refresh `@main`: open `https://purge.jsdelivr.net/gh/Aleshuk/looker-viz-stepped-sankey@main/stepped_sankey.js`.

## 3. Register in Looker

Admin → Platform → Visualizations → **Add Visualization**

| Field | Value |
|---|---|
| ID | `stepped_sankey` (must match the `id` in the registration call) |
| Label | `Stepped Funnel Sankey` |
| Main | the jsdelivr URL above (SHA-pinned for production) |

Save.

## 4. Test in an Explore

1. Pick an explore exposing the 4 step dimensions + the count measure
   (LookML view/explore from the dbt PR — see the DBI-5310 looker-main PR).
2. Add the dimensions **in step order**, then the measure.
3. Switch the visualization type to **Stepped Funnel Sankey**.
4. Verify: nodes render per step, ribbons connect consecutive steps, % labels show retention
   vs. step 1, tooltips work on nodes and links, resize reflows, and the right-hand options
   panel (Bucket %, palette, labels, etc.) all take effect.

## 5. Updating

Edit → commit → push → purge `@main` (or re-pin the Main URL to the new SHA). For production,
always pin to a SHA and re-pin when you ship.

## 6. Local validation (before Looker)

Open `test/harness.html` in a browser. It stubs `window.looker`, loads the viz, and renders
synthetic production-flow data — catches most bugs without a Looker round-trip.

---

## Options (right-hand panel in Looker)

| Option | Default | Notes |
|---|---|---|
| Bucket below (% of step) into "Other" | 5 | 0 disables bucketing |
| Color Palette | Looker | Looker / Cool / Warm / Mono Blue |
| Show Node Labels | on | name beside each node bar |
| Show Values | on | formatted measure value |
| Show % of Step 1 | on | retention vs. first step |
| Node Width / Gap (px) | 22 / 14 | bar geometry |
| Link Opacity (0–1) | 0.4 | ribbon transparency |
| Font Size | 12 | |
