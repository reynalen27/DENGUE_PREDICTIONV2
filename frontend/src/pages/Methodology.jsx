import { PageHeader } from '../components/Controls.jsx'
import { Card, CardBody, CardFoot, CardHead } from '../components/Card.jsx'
import DataTable from '../components/DataTable.jsx'
import Icon from '../components/Icon.jsx'

/*
 * The modelling reference: every equation the forecasting service is specified
 * to implement, derived from the data's own constraints.
 *
 * Two deliberate choices here. First, the maths is plain HTML -- sub/sup and
 * the mono stack -- not KaTeX or MathJax. The app ships no external request on
 * any other page, and a 280KB font-and-parser dependency to set thirty display
 * equations is not a trade worth making; the notation is elementary enough
 * that markup carries it. Second, every claim is tagged with where it comes
 * from: `from the repo` means the project already decided it, `open design
 * gap` means the equation is a standard formalisation filling a blank the repo
 * leaves open. Without that split a reader cannot tell specification from
 * suggestion, and this page would quietly become a source of truth it has no
 * right to be.
 */

const SECTIONS = [
  { id: 'data', n: '01', kicker: 'Foundation', title: 'Why the data dictates the math' },
  { id: 'features', n: '02', kicker: 'Preprocessing', title: 'Feature construction' },
  { id: 'sarima', n: '03', kicker: 'Baseline A', title: 'SARIMA(2,1,2)' },
  { id: 'lstm', n: '04', kicker: 'Baseline B', title: 'LSTM-64' },
  { id: 'hybrid', n: '05', kicker: 'Primary model', title: 'Bayesian-neural hybrid' },
  { id: 'metrics', n: '06', kicker: 'Scoring', title: 'Five metrics' },
  { id: 'alerts', n: '07', kicker: 'Downstream', title: 'Risk thresholding' },
  { id: 'pipeline', n: '08', kicker: 'Process', title: 'End-to-end pipeline' },
]

/** Italic variable, so `r` the region never reads as `r` the correlation. */
function V({ children }) {
  return <i className="eq-var">{children}</i>
}

function Eq({ children }) {
  return <div className="eq">{children}</div>
}

function EqBlock({ children, cap }) {
  return (
    <div className="eq-block">
      <div className="eq-scroll">{children}</div>
      {cap && <p className="eq-cap">{cap}</p>}
    </div>
  )
}

/** `doc` = the project already decided this. `gap` = we are proposing it. */
function Tag({ kind, children }) {
  return <span className={`prov prov-${kind}`}>{children}</span>
}

function Section({ id, n, kicker, title, lead, children }) {
  return (
    <section className="doc-section" id={id} aria-labelledby={`${id}-h`}>
      <p className="doc-kicker">{n} — {kicker}</p>
      <h2 className="doc-h2" id={`${id}-h`}>{title}</h2>
      {lead && <p className="doc-lead">{lead}</p>}
      {children}
    </section>
  )
}

const CORRELATIONS = [
  { pair: 'cases ~ rainfall', r: '−0.16' },
  { pair: 'cases ~ mean temperature', r: '−0.10' },
  { pair: 'cases ~ humidity', r: '−0.12' },
]

const INCIDENCE_2024 = [
  { province: 'Cavite', cases: '14,261', per100k: '328.2', lead: false },
  { province: 'Rizal', cases: '11,848', per100k: '355.8', lead: true },
  { province: 'Laguna', cases: '8,857', per100k: '261.9', lead: false },
  { province: 'Quezon', cases: '6,844', per100k: '307.0', lead: false },
  { province: 'Batangas', cases: '4,693', per100k: '161.4', lead: false },
]

const DEMO_METRICS = [
  { model: 'SARIMA', rmse: '42.1', mae: '31.4', mape: '18.2', crps: '27.6', coverage: '71.2', best: false },
  { model: 'LSTM', rmse: '35.7', mae: '26.8', mape: '15.1', crps: '22.9', coverage: '68.5', best: false },
  { model: 'Bayesian-neural hybrid', rmse: '28.3', mae: '21.0', mape: '11.4', crps: '17.2', coverage: '89.6', best: true },
]

const PIPELINE = [
  {
    title: 'Ingest and repair',
    body: (
      <>
        ETL fixes the −999 sentinel, the 11 OCR-corrupted municipality names, and recovers the
        dropped province column via block-purity checking — implemented today in{' '}
        <code>backend/scripts/etl/</code>, runs via <code>npm run etl</code>.
      </>
    ),
  },
  {
    title: 'Build the training panel',
    body: (
      <>
        Join <code>case_data</code> + lagged <code>climate_data</code> (§2.2) +{' '}
        <code>demographic_data</code> as a log-population offset (§2.3) + the static HDI prior per
        province (§2.4). <strong>Blocked</strong> until weekly or monthly case counts replace the
        current 5-points-per-LGU annual series.
      </>
    ),
  },
  {
    title: 'Specify the model',
    body: 'Negative-binomial likelihood, GRU-32 mean function, hierarchical province intercept with an HDI-informed prior — §5.1–§5.4.',
  },
  {
    title: 'Fit',
    body: (
      <>
        Approximate the joint posterior (§5.4) as a batch job — hours, not milliseconds, per{' '}
        <code>ARCHITECTURE.md</code>&rsquo;s reasoning for splitting the model service from the
        interactive API.
      </>
    ),
  },
  {
    title: 'Sample the posterior predictive',
    body: (
      <>
        Draw <V>S</V> forecasts per region-week, take the median and the 2.5 / 97.5 percentiles
        (§5.5) to populate <code>predicted_cases</code>, <code>ci_lower</code>,{' '}
        <code>ci_upper</code>.
      </>
    ),
  },
  {
    title: 'Score on held-out weeks',
    body: (
      <>
        RMSE, MAE, MAPE, CRPS and coverage (§6) computed against true values the model never
        trained on, written to <code>evaluation_metrics</code> keyed by <code>model_run_id</code>.
      </>
    ),
  },
  {
    title: 'Threshold into an alert',
    body: 'Convert the forecast to per-100k incidence and apply the quantile rule (§7) to produce a risk_level row.',
  },
  {
    title: 'Write and serve',
    body: (
      <>
        The model service inserts into <code>model_runs</code> / <code>predictions</code> /{' '}
        <code>evaluation_metrics</code> / <code>alerts</code>; the Node API reads the newest run
        (<code>trained_at DESC, id DESC</code>); this SPA renders the forecast band, the comparison
        charts and the alert table with no code change on either side of the database boundary.
      </>
    ),
  },
]

export default function Methodology() {
  return (
    <>
      <PageHeader
        title="The mathematics of the Bayesian-neural hybrid"
        description="A full derivation of the forecasting model this app is built to display — from the raw data's constraints, through the SARIMA and LSTM baselines, to the hierarchical Bayesian / GRU hybrid and the five metrics that score all three."
      />

      {/*
        This warning is the first thing on the page on purpose. Every equation
        below is a specification, not a description of running code, and a
        reader who misses that will read the metrics table in §6 as a result.
      */}
      <Card className="doc-scope">
        <CardBody>
          <div className="doc-scope-inner">
            <span className="doc-scope-mark" aria-hidden="true">
              <Icon name="warning" size={18} />
            </span>
            <div>
              <h2 className="doc-scope-title">Where this math lives</h2>
              <p>
                <strong>The model itself is not implemented in this repository.</strong>{' '}
                <code>ARCHITECTURE.md</code> is explicit: the Bayesian-neural hybrid is a separate
                Python service, still to be built, that will write into <code>predictions</code> /{' '}
                <code>evaluation_metrics</code> / <code>alerts</code>. This repo has only the schema
                those tables expect, a data-quality audit, and demo hyperparameters used to seed the
                UI.
              </p>
              <p>
                What follows formalises <em>that documented design</em> into full equations — the
                hierarchical prior, the GRU mean function, and the SARIMA(2,1,2) and LSTM-64
                baselines named in <code>seed.js</code> — grounded in the project&rsquo;s own schema
                and audit. Passages marked <Tag kind="doc">from the repo</Tag> quote a decision the
                project already made; passages marked <Tag kind="gap">open design gap</Tag> are
                standard formalisations filling a blank the repo leaves open. The numbers in §6 are
                seeded demo values, flagged in code as illustrative — not a real evaluation.
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      <div className="doc-layout section-gap">
        <div className="doc-main">

          <Section
            id="data"
            n="01"
            kicker="Foundation"
            title="Why the data dictates the math"
            lead={(
              <>
                Before any model equation, one constraint from <code>DATA_ASSESSMENT.md</code>{' '}
                shapes every choice below: the case data is annual, and the model is specified to
                forecast weekly.
              </>
            )}
          >
            <EqBlock
              cap={(
                <>
                  A credible interval needs a likelihood over repeated observations. At n=5 the
                  posterior is dominated by the prior — the interval then describes your prior, not
                  dengue. <Tag kind="doc">from the repo</Tag>
                </>
              )}
            >
              <Eq>
                n<sub>obs</sub> per LGU &nbsp;=&nbsp; 5 &nbsp;&nbsp;(2020–2024, one point per year)
              </Eq>
            </EqBlock>

            <p className="doc-p">
              The correlation table in the audit is the sharpest illustration of why annual
              aggregation is dangerous. It is the ordinary Pearson coefficient over the only 20 rows
              available — 4 provinces × 5 years, since Laguna has no weather station:
            </p>

            <EqBlock>
              <Eq>
                r &nbsp;=&nbsp; Σ(x<sub>i</sub> − x̄)(y<sub>i</sub> − ȳ) &nbsp;/&nbsp; √[ Σ(x
                <sub>i</sub> − x̄)² · Σ(y<sub>i</sub> − ȳ)² ]
              </Eq>
            </EqBlock>

            <Card className="doc-card">
              <CardHead
                title="Annual cases vs. annual climate"
                description="Pearson r, n = 20 province-years."
              />
              <DataTable
                caption="Correlation between annual dengue cases and annual climate aggregates"
                rows={CORRELATIONS}
                getRowKey={(row) => row.pair}
                columns={[
                  { key: 'pair', header: 'Pair', className: 'cell-strong' },
                  { key: 'r', header: 'r', align: 'right' },
                ]}
              />
            </Card>

            <p className="doc-p">
              Read literally this says climate barely matters. It doesn&rsquo;t — monthly rainfall
              swings six-fold across the year (81mm March trough → 489mm October peak), but annual
              totals average that seasonality away completely, and with it the one signal a weekly
              model exists to capture. This is the single justification for every lag and seasonal
              term in §2–§5: <strong>the model only works at a resolution the current case data
              cannot yet supply</strong>, which is why the audit calls sourcing weekly case counts
              the only item that unblocks the model.
            </p>

            <h3 className="doc-h3">1.1 Population as denominator, not covariate</h3>
            <p className="doc-p">
              Raw case counts also mislead across unevenly sized LGUs. The audit computes incidence
              per 100k to show it:
            </p>
            <EqBlock>
              <Eq>
                I<sub><V>r</V>,<V>y</V></sub> &nbsp;=&nbsp; ( C<sub><V>r</V>,<V>y</V></sub> /
                P<sub><V>r</V>,<V>y</V></sub> ) × 100,000
              </Eq>
            </EqBlock>

            <Card className="doc-card">
              <CardHead
                title="2024, ranked by volume vs. by incidence"
                description="Cavite leads on volume; Rizal leads on incidence."
              />
              <DataTable
                caption="2024 dengue cases and incidence per 100,000 by province"
                rows={INCIDENCE_2024}
                getRowKey={(row) => row.province}
                columns={[
                  {
                    key: 'province',
                    header: 'Province',
                    className: 'cell-strong',
                    render: (r) => (r.lead ? <strong>{r.province}</strong> : r.province),
                  },
                  { key: 'cases', header: 'Cases', align: 'right' },
                  {
                    key: 'per100k',
                    header: 'Per 100k',
                    align: 'right',
                    render: (r) => (r.lead ? <span className="cell-best">{r.per100k}</span> : r.per100k),
                  },
                ]}
              />
              <CardFoot>
                A system that ranks by raw count sends resources to the wrong province — which is
                why §5&rsquo;s likelihood treats population as a fixed offset rather than a free
                regression coefficient.
              </CardFoot>
            </Card>
          </Section>

          <Section
            id="features"
            n="02"
            kicker="Preprocessing"
            title="Feature construction"
            lead={(
              <>
                Everything here operates on the schema&rsquo;s four observed tables (
                <code>case_data</code>, <code>climate_data</code>, <code>demographic_data</code>,{' '}
                <code>vector_data</code>) plus the static HDI file, in the audit&rsquo;s §7
                recommended order of work.
              </>
            )}
          >
            <h3 className="doc-h3">2.1 Sentinel repair</h3>
            <EqBlock
              cap={(
                <>
                  PAGASA&rsquo;s missing-data code is a valid float, so <code>pandas.read_csv</code>{' '}
                  reports zero nulls unless this substitution runs first. One row (Ambulong, Jan
                  2020) is fully sentinel-filled.{' '}
                  <Tag kind="doc">implemented in normalize.js</Tag>
                </>
              )}
            >
              <Eq>x<sub>clean</sub> &nbsp;=&nbsp; NULL &nbsp;if&nbsp; x = −999 &nbsp;else&nbsp; x</Eq>
            </EqBlock>

            <h3 className="doc-h3">2.2 Lag and moving-average features</h3>
            <EqBlock
              cap="Rainfall and temperature at 1–3 month lags, ENSO at 3–6 months — the audit's exact §7 recommendation, since dengue incubation and mosquito breeding cycles trail the weather that drives them."
            >
              <Eq>
                X<sup>lag<V>k</V></sup><sub><V>r</V>,<V>t</V></sub> &nbsp;=&nbsp; X<sub><V>r</V>,
                <V>t</V>−<V>k</V></sub>, &nbsp;&nbsp; <V>k</V> ∈ {'{'}1, 2, 3{'}'} &nbsp;(months)
              </Eq>
              <Eq>
                MA<sub>3</sub>(X)<sub><V>r</V>,<V>t</V></sub> &nbsp;=&nbsp; (1/3) Σ<sub><V>k</V>=1</sub>
                <sup>3</sup> X<sub><V>r</V>,<V>t</V>−<V>k</V></sub>
              </Eq>
              <Eq>
                X<sup>enso,lag</sup><sub><V>r</V>,<V>t</V></sub> &nbsp;=&nbsp; ENSO<sub><V>t</V>−<V>L</V></sub>,
                &nbsp;&nbsp; <V>L</V> ∈ [3, 6] &nbsp;(months)
              </Eq>
            </EqBlock>

            <h3 className="doc-h3">2.3 Population as a fixed offset</h3>
            <EqBlock
              cap={(
                <>
                  The underlined term enters with a fixed coefficient of 1 — an offset, exactly as §3
                  of the audit specifies — so the model learns a <em>rate</em>, and population
                  differences never have to be re-learned as a free slope.{' '}
                  <Tag kind="doc">from the repo</Tag>
                </>
              )}
            >
              <Eq>
                E[C<sub><V>r</V>,<V>t</V></sub>] &nbsp;=&nbsp; P<sub><V>r</V>,<V>t</V></sub> · rate
                <sub><V>r</V>,<V>t</V></sub>
              </Eq>
              <Eq>
                ⇒ &nbsp; log E[C<sub><V>r</V>,<V>t</V></sub>] &nbsp;=&nbsp;{' '}
                <u>log P<sub><V>r</V>,<V>t</V></sub></u> + η<sub><V>r</V>,<V>t</V></sub>
              </Eq>
            </EqBlock>

            <h3 className="doc-h3">2.4 Province random effect, HDI as a static prior</h3>
            <EqBlock
              cap={(
                <>
                  The audit is explicit that HDI (5 provinces, 2009 and 2012 only) cannot be a
                  time-varying covariate, but is a legitimate use in a hierarchical prior —
                  Quezon&rsquo;s 0.55 against Rizal&rsquo;s 0.82 plausibly explains baseline gaps in
                  reporting completeness, not year-to-year change.{' '}
                  <Tag kind="doc">from the repo</Tag>
                </>
              )}
            >
              <Eq>
                α<sub><V>p</V></sub> &nbsp;~&nbsp; Normal( μ<sub><V>p</V></sub> , τ² ), &nbsp;&nbsp;
                μ<sub><V>p</V></sub> &nbsp;=&nbsp; γ<sub>0</sub> + γ<sub>1</sub>·HDI<sub><V>p</V></sub>
              </Eq>
            </EqBlock>
          </Section>

          <Section
            id="sarima"
            n="03"
            kicker="Baseline A"
            title="SARIMA(2,1,2)"
            lead={(
              <>
                Named in <code>seed.js</code> as <code>{'{ p: 2, d: 1, q: 2 }'}</code>. With the
                backshift operator <V>B</V>y<sub><V>t</V></sub> = y<sub><V>t</V>−1</sub>:
              </>
            )}
          >
            <EqBlock>
              <Eq>
                (1 − φ<sub>1</sub><V>B</V> − φ<sub>2</sub><V>B</V>²)(1 − <V>B</V>)<sup>1</sup> y
                <sub><V>t</V></sub> &nbsp;=&nbsp; <V>c</V> + (1 + θ<sub>1</sub><V>B</V> + θ
                <sub>2</sub><V>B</V>²) ε<sub><V>t</V></sub>
              </Eq>
              <Eq>ε<sub><V>t</V></sub> &nbsp;~&nbsp; Normal(0, σ²) &nbsp;i.i.d.</Eq>
            </EqBlock>

            <p className="doc-p">
              Expanded, writing Δy<sub><V>t</V></sub> = y<sub><V>t</V></sub> − y<sub><V>t</V>−1</sub>{' '}
              for the <V>d</V>=1 difference that removes the trend:
            </p>

            <EqBlock
              cap={(
                <>
                  Fit by maximising the Gaussian log-likelihood over (φ<sub>1</sub>, φ<sub>2</sub>, θ
                  <sub>1</sub>, θ<sub>2</sub>, σ²); forecast by recursive substitution, setting
                  future ε to their expectation of 0.
                </>
              )}
            >
              <Eq>
                Δy<sub><V>t</V></sub> &nbsp;=&nbsp; φ<sub>1</sub>Δy<sub><V>t</V>−1</sub> + φ
                <sub>2</sub>Δy<sub><V>t</V>−2</sub> + ε<sub><V>t</V></sub> + θ<sub>1</sub>ε
                <sub><V>t</V>−1</sub> + θ<sub>2</sub>ε<sub><V>t</V>−2</sub>
              </Eq>
            </EqBlock>

            <p className="doc-p">
              <Tag kind="gap">open design gap</Tag> The stored hyperparameters carry only the
              non-seasonal order (<V>p</V>,<V>d</V>,<V>q</V>). A true weekly dengue series — the
              whole point of §1 — has a strong annual cycle, which a plain ARIMA(2,1,2) cannot
              represent. It would need a seasonal term (<V>P</V>,<V>D</V>,<V>Q</V>)<sub>52</sub>{' '}
              multiplying the equation above by{' '}
              <span className="mono">(1 − Φ<sub>1</sub><V>B</V><sup>52</sup>)(1 − <V>B</V><sup>52</sup>)<sup>D</sup></span>.
              This is a real gap between the seeded label &ldquo;SARIMA&rdquo; and what the
              hyperparameters in <code>seed.js</code> actually specify.
            </p>
          </Section>

          <Section
            id="lstm"
            n="04"
            kicker="Baseline B"
            title="LSTM-64"
            lead={(
              <>
                <code>seed.js</code>: <code>{'{ units: 64, epochs: 50 }'}</code>. The standard gated
                recurrent equations, hidden state h<sub><V>t</V></sub> ∈ ℝ<sup>64</sup>, over the
                lag-feature sequence from §2:
              </>
            )}
          >
            <EqBlock>
              <Eq>
                f<sub><V>t</V></sub> &nbsp;=&nbsp; σ(W<sub>f</sub>·[h<sub><V>t</V>−1</sub>, x
                <sub><V>t</V></sub>] + b<sub>f</sub>) &nbsp;&nbsp;<span className="eq-note">forget gate</span>
              </Eq>
              <Eq>
                i<sub><V>t</V></sub> &nbsp;=&nbsp; σ(W<sub>i</sub>·[h<sub><V>t</V>−1</sub>, x
                <sub><V>t</V></sub>] + b<sub>i</sub>) &nbsp;&nbsp;<span className="eq-note">input gate</span>
              </Eq>
              <Eq>
                c̃<sub><V>t</V></sub> &nbsp;=&nbsp; tanh(W<sub>c</sub>·[h<sub><V>t</V>−1</sub>, x
                <sub><V>t</V></sub>] + b<sub>c</sub>) &nbsp;&nbsp;<span className="eq-note">candidate cell state</span>
              </Eq>
              <Eq>
                c<sub><V>t</V></sub> &nbsp;=&nbsp; f<sub><V>t</V></sub> ⊙ c<sub><V>t</V>−1</sub> + i
                <sub><V>t</V></sub> ⊙ c̃<sub><V>t</V></sub> &nbsp;&nbsp;<span className="eq-note">cell update</span>
              </Eq>
              <Eq>
                o<sub><V>t</V></sub> &nbsp;=&nbsp; σ(W<sub>o</sub>·[h<sub><V>t</V>−1</sub>, x
                <sub><V>t</V></sub>] + b<sub>o</sub>), &nbsp; h<sub><V>t</V></sub> &nbsp;=&nbsp; o
                <sub><V>t</V></sub> ⊙ tanh(c<sub><V>t</V></sub>)
              </Eq>
            </EqBlock>

            <p className="doc-p">
              Readout to a scalar case-count forecast, trained by gradient descent (Adam) minimising
              mean squared error over 50 epochs:
            </p>

            <EqBlock>
              <Eq>ŷ<sub><V>t</V></sub> &nbsp;=&nbsp; W<sub>y</sub> h<sub><V>t</V></sub> + b<sub>y</sub></Eq>
              <Eq>
                ℒ(θ) &nbsp;=&nbsp; (1/N) Σ<sub><V>i</V>=1</sub><sup>N</sup> (y<sub><V>i</V></sub> − ŷ
                <sub><V>i</V></sub>)²
              </Eq>
            </EqBlock>

            <p className="doc-p">
              No credible interval falls out of this by construction — an LSTM point-forecasts. The{' '}
              <code>ci_lower</code> / <code>ci_upper</code> columns the schema expects would need a
              second pass (quantile-loss heads, or MC-dropout sampling) that the seeded
              hyperparameters do not specify. <Tag kind="gap">open design gap</Tag>
            </p>
          </Section>

          <Section
            id="hybrid"
            n="05"
            kicker="Primary model"
            title="Bayesian-neural hybrid"
            lead={(
              <>
                <code>seed.js</code>: <code>{"{ prior: 'hierarchical', nn: 'GRU-32' }"}</code> — a
                hierarchical Bayesian regression whose mean function is a 32-unit GRU. That is what
                &ldquo;hybrid&rdquo; refers to: a neural sequence encoder feeding a Bayesian
                generalised linear model, fit jointly.
              </>
            )}
          >
            <h3 className="doc-h3">5.1 Likelihood — why not Gaussian</h3>
            <p className="doc-p">
              Case counts are non-negative integers whose variance grows with the mean (CALABARZON
              ran 8,933 → 46,503 across five years). A negative-binomial likelihood is the standard
              choice over Poisson because it adds a free dispersion parameter <V>φ</V> instead of
              forcing mean = variance:
            </p>
            <EqBlock>
              <Eq>
                C<sub><V>r</V>,<V>t</V></sub> &nbsp;~&nbsp; NegBinomial( λ<sub><V>r</V>,<V>t</V></sub>,{' '}
                <V>φ</V> )
              </Eq>
              <Eq>
                Var[C<sub><V>r</V>,<V>t</V></sub>] &nbsp;=&nbsp; λ<sub><V>r</V>,<V>t</V></sub> + λ
                <sub><V>r</V>,<V>t</V></sub>² / <V>φ</V>
              </Eq>
            </EqBlock>

            <h3 className="doc-h3">5.2 The GRU mean function</h3>
            <p className="doc-p">
              The neural half — 32 hidden units, matching the seed&rsquo;s <code>GRU-32</code> —
              encodes the lagged feature sequence x<sub><V>r</V>,<V>t</V>−<V>L</V>:<V>t</V></sub>{' '}
              from §2 into a nonlinear log-rate contribution:
            </p>
            <EqBlock>
              <Eq>
                z<sub><V>t</V></sub> &nbsp;=&nbsp; σ(W<sub>z</sub>x<sub><V>t</V></sub> + U<sub>z</sub>h
                <sub><V>t</V>−1</sub>) &nbsp;&nbsp;<span className="eq-note">update gate</span>
              </Eq>
              <Eq>
                r<sub><V>t</V></sub> &nbsp;=&nbsp; σ(W<sub>r</sub>x<sub><V>t</V></sub> + U<sub>r</sub>h
                <sub><V>t</V>−1</sub>) &nbsp;&nbsp;<span className="eq-note">reset gate</span>
              </Eq>
              <Eq>
                h̃<sub><V>t</V></sub> &nbsp;=&nbsp; tanh(W<sub>h</sub>x<sub><V>t</V></sub> + U
                <sub>h</sub>(r<sub><V>t</V></sub> ⊙ h<sub><V>t</V>−1</sub>))
              </Eq>
              <Eq>
                h<sub><V>t</V></sub> &nbsp;=&nbsp; (1−z<sub><V>t</V></sub>) ⊙ h<sub><V>t</V>−1</sub> + z
                <sub><V>t</V></sub> ⊙ h̃<sub><V>t</V></sub>, &nbsp;&nbsp; h<sub><V>t</V></sub> ∈ ℝ
                <sup>32</sup>
              </Eq>
              <Eq>
                g<sub>θ</sub>(x<sub><V>r</V>,<V>t</V></sub>) &nbsp;=&nbsp; w<sub>out</sub>
                <sup>T</sup> h<sub><V>T</V></sub> + b<sub>out</sub>
              </Eq>
            </EqBlock>

            <h3 className="doc-h3">5.3 Assembling the linear predictor</h3>
            <p className="doc-p">
              The offset (§2.3), the province random effect (§2.4) and the GRU output combine
              additively on the log scale:
            </p>
            <EqBlock cap="offset + hierarchical province intercept + nonlinear climate/vector signal.">
              <Eq>
                log λ<sub><V>r</V>,<V>t</V></sub> &nbsp;=&nbsp; log P<sub><V>r</V>,<V>t</V></sub>{' '}
                &nbsp;+&nbsp; α<sub><V>p</V>(<V>r</V>)</sub> &nbsp;+&nbsp; g<sub>θ</sub>(x
                <sub><V>r</V>,<V>t</V></sub>)
              </Eq>
            </EqBlock>

            <h3 className="doc-h3">5.4 Priors and joint posterior</h3>
            <EqBlock>
              <Eq>
                α<sub><V>p</V></sub> ~ Normal(γ<sub>0</sub>+γ<sub>1</sub>HDI<sub><V>p</V></sub>, τ²),
                &nbsp; γ<sub>0</sub>,γ<sub>1</sub> ~ Normal(0,5), &nbsp; τ ~ HalfNormal(1), &nbsp; φ ~
                HalfNormal(5)
              </Eq>
              <Eq>
                {'{W,U}'} ~ Normal(0, σ<sub>w</sub>²) &nbsp;&nbsp;
                <span className="eq-note">weakly-informative GRU weight prior — a Bayesian analogue of weight decay</span>
              </Eq>
              <Eq>
                p(θ,α,γ,τ,φ | D) &nbsp;∝&nbsp; [ Π<sub><V>r</V>,<V>t</V></sub> NegBinomial(C
                <sub><V>r</V>,<V>t</V></sub> | λ<sub><V>r</V>,<V>t</V></sub>, φ) ] · p(α|γ,τ) · p(γ) ·
                p(τ) · p(φ) · p(θ)
              </Eq>
            </EqBlock>
            <p className="doc-p">
              Because g<sub>θ</sub> is a nonlinear GRU, this posterior has no closed form. The
              hybrid inference scheme approximates it — for instance Hamiltonian / NUTS sampling
              over the shallow hierarchical parameters with the network weights fit by
              gradient-based MAP or a variational approximation. That is also why{' '}
              <code>ARCHITECTURE.md</code> describes training as a batch job on the order of hours
              rather than an interactive query. The repo names no inference scheme.{' '}
              <Tag kind="gap">open design gap</Tag>
            </p>

            <h3 className="doc-h3">5.5 From posterior to the schema&rsquo;s three columns</h3>
            <p className="doc-p">
              Draw <V>S</V> samples from the fitted posterior, propagate each through §5.3, and
              sample the likelihood. This is exactly what becomes <code>predicted_cases</code>,{' '}
              <code>ci_lower</code> and <code>ci_upper</code> in the <code>predictions</code> table:
            </p>
            <EqBlock>
              <Eq>
                {'{θ⁽ˢ⁾, α⁽ˢ⁾, γ⁽ˢ⁾, φ⁽ˢ⁾}'}<sub><V>s</V>=1</sub><sup><V>S</V></sup> &nbsp;~&nbsp; p(· | D)
              </Eq>
              <Eq>
                C̃<sub><V>r</V>,<V>t</V></sub><sup>(s)</sup> &nbsp;~&nbsp; NegBinomial(λ
                <sub><V>r</V>,<V>t</V></sub><sup>(s)</sup>, φ<sup>(s)</sup>)
              </Eq>
              <Eq>
                predicted_cases &nbsp;=&nbsp; median<sub><V>s</V></sub> {'{ C̃⁽ˢ⁾ }'}
              </Eq>
              <Eq>
                ci_lower, ci_upper &nbsp;=&nbsp; [ Q<sub>2.5</sub> , Q<sub>97.5</sub> ]<sub><V>s</V></sub>{' '}
                {'{ C̃⁽ˢ⁾ }'}
              </Eq>
            </EqBlock>
          </Section>

          <Section
            id="metrics"
            n="06"
            kicker="Scoring"
            title="Five metrics, one column each"
            lead={(
              <>
                The <code>evaluation_metrics</code> schema fixes five columns: <code>rmse</code>,{' '}
                <code>mae</code>, <code>mape</code>, <code>crps</code>, <code>coverage</code>. Three
                measure point-forecast error; two specifically test the credible interval — which is
                why a point-forecasting model structurally under-performs on the last two.
              </>
            )}
          >
            <EqBlock>
              <Eq>RMSE &nbsp;=&nbsp; √[ (1/N) Σᵢ (yᵢ − ŷᵢ)² ]</Eq>
              <Eq>MAE &nbsp;=&nbsp; (1/N) Σᵢ |yᵢ − ŷᵢ|</Eq>
              <Eq>
                MAPE &nbsp;=&nbsp; (100/N) Σᵢ |yᵢ − ŷᵢ| / yᵢ &nbsp;&nbsp;
                <span className="eq-note">undefined at yᵢ=0 — a real hazard for LGU-weeks with zero cases</span>
              </Eq>
            </EqBlock>

            <EqBlock
              cap={(
                <>
                  The continuous ranked probability score, estimated from the <V>S</V>{' '}
                  posterior-predictive draws of §5.5. It scores the whole predictive distribution,
                  not just its centre — which is exactly why only a probabilistic model (the hybrid,
                  or SARIMA&rsquo;s Gaussian forecast interval) can produce one at all. An LSTM
                  point-forecast has no native CRPS.
                </>
              )}
            >
              <Eq>CRPS(F, y) &nbsp;=&nbsp; ∫ ( F(x) − <b>1</b>{'{x ≥ y}'} )² dx</Eq>
              <Eq>
                &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;≈&nbsp; (1/S)Σₛ|xₛ−y| −
                (1/2S²)Σₛ Σₛ&prime; |xₛ−xₛ&prime;|
              </Eq>
            </EqBlock>

            <EqBlock cap="The fraction of held-out true values that actually fell inside the published interval — it should track the nominal level (~95%) if the interval is honest, not merely narrow.">
              <Eq>
                coverage &nbsp;=&nbsp; (1/N) Σᵢ <b>1</b>
                {'{ ci_lower'}<sub><V>i</V></sub>{' ≤ yᵢ ≤ ci_upper'}<sub><V>i</V></sub>{' }'}
              </Eq>
            </EqBlock>

            <Card className="doc-card">
              <CardHead
                title="Seeded demo values"
                description="backend/src/config/seed.js — the hybrid is deliberately scored best, to illustrate the comparative-evaluation study."
              />
              <DataTable
                caption="Illustrative evaluation metrics seeded into the database"
                rows={DEMO_METRICS}
                getRowKey={(row) => row.model}
                columns={[
                  {
                    key: 'model',
                    header: 'Model',
                    className: 'cell-strong',
                    render: (r) => (r.best ? <strong>{r.model}</strong> : r.model),
                  },
                  { key: 'rmse', header: 'RMSE', align: 'right' },
                  { key: 'mae', header: 'MAE', align: 'right' },
                  { key: 'mape', header: 'MAPE (%)', align: 'right' },
                  { key: 'crps', header: 'CRPS', align: 'right' },
                  { key: 'coverage', header: 'Coverage (%)', align: 'right' },
                ]}
              />
              <CardFoot>
                These rows exist purely so no chart on the model comparison page is empty on first
                run. They are not the output of any training run against real data — none has
                happened, per §1.
              </CardFoot>
            </Card>
          </Section>

          <Section
            id="alerts"
            n="07"
            kicker="Downstream"
            title={<>Risk thresholding <Tag kind="gap">open design gap</Tag></>}
            lead={(
              <>
                The <code>alerts</code> table stores an ENUM — <code>low</code> / <code>moderate</code>{' '}
                / <code>high</code> / <code>severe</code> — but no file in the repo defines the
                cutoffs. The natural formalisation, consistent with §1&rsquo;s
                incidence-not-volume argument, is a quantile rule over the posterior-predictive
                incidence rate rather than an absolute case count:
              </>
            )}
          >
            <EqBlock
              cap={(
                <>
                  Quantiles Q<sub>50/75/90</sub> are taken over each LGU&rsquo;s own historical
                  incidence distribution, so a &ldquo;high&rdquo; alert means high <em>for that
                  place</em>. Not proposed anywhere in the repo, but the smallest addition
                  consistent with everything above it.
                </>
              )}
            >
              <Eq>
                Î<sub><V>r</V>,<V>t</V></sub> &nbsp;=&nbsp; ( predicted_cases<sub><V>r</V>,<V>t</V></sub>{' '}
                / P<sub><V>r</V>,<V>t</V></sub> ) × 100,000
              </Eq>
              <Eq>
                risk_level &nbsp;=&nbsp; low &nbsp;if&nbsp; Î &lt; Q<sub>50</sub>(Î<sub>hist</sub>)
              </Eq>
              <Eq>
                &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; moderate
                &nbsp;if&nbsp; Q<sub>50</sub> ≤ Î &lt; Q<sub>75</sub>
              </Eq>
              <Eq>
                &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; high
                &nbsp;if&nbsp; Q<sub>75</sub> ≤ Î &lt; Q<sub>90</sub>
              </Eq>
              <Eq>
                &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; severe
                &nbsp;if&nbsp; Î ≥ Q<sub>90</sub>
              </Eq>
            </EqBlock>
          </Section>

          <Section
            id="pipeline"
            n="08"
            kicker="Process"
            title="End-to-end pipeline"
            lead="The order this actually has to run in, tying every section above to a concrete artefact."
          >
            <ol className="doc-steps">
              {PIPELINE.map((step, i) => (
                <li key={step.title}>
                  <span className="doc-step-n" aria-hidden="true">{i + 1}</span>
                  <span className="doc-step-body">
                    <span className="doc-step-title">{step.title}</span>
                    <span className="doc-step-desc">{step.body}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Section>

          <p className="doc-source">
            Sourced from <code>markdown/ARCHITECTURE.md</code>,{' '}
            <code>markdown/DATA_ASSESSMENT.md</code>, <code>backend/migrations/schema.sql</code> and{' '}
            <code>backend/src/config/seed.js</code>. These equations formalise the project&rsquo;s
            documented design; they are not extracted from an existing implementation, because that
            implementation does not yet exist in this repository.
          </p>
        </div>

        <nav className="doc-toc" aria-label="On this page">
          <div className="doc-toc-inner">
            <p className="eyebrow doc-toc-head">Contents</p>
            <ol>
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`}>
                    <span className="doc-toc-n">{s.n}</span>
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </nav>
      </div>
    </>
  )
}
