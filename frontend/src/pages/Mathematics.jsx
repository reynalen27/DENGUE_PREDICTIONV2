import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useFetch } from '../hooks/useFetch.js'
import { panelApi } from '../services/api.js'
import { Card, CardBody, CardFoot, CardHead } from '../components/Card.jsx'
import { PageHeader } from '../components/Controls.jsx'
import { SkeletonRows } from '../components/States.jsx'
import Formula from '../components/Formula.jsx'
import DataTable from '../components/DataTable.jsx'
import Icon from '../components/Icon.jsx'
import { formatInt, formatNumber, toNumber } from '../lib/format.js'

/*
 * The page answers one question the other five do not: *why does any of this
 * arithmetic help a health officer decide something?* Every section therefore
 * pairs a formula with the decision it changes. A formula with no decision
 * attached does not belong here.
 *
 * The spine is section 2. Lead time is the entire product: if cases depended
 * only on this month's weather there would be no warning to give, just a
 * report. The lag is what turns a description into an early warning, and the
 * 2019 CALABARZON numbers below are real, not illustrative.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function Changes({ children }) {
  return (
    <div className="math-changes">
      <span className="math-changes-tag">
        <Icon name="target" size={13} strokeWidth={2} />
        What this changes
      </span>
      <p>{children}</p>
    </div>
  )
}

function Section({ n, title, lead, children, foot }) {
  return (
    <Card className="section-gap">
      <CardHead title={`${n} · ${title}`} description={lead} />
      <CardBody className="math-body">{children}</CardBody>
      {foot && <CardFoot>{foot}</CardFoot>}
    </Card>
  )
}

export default function Mathematics() {
  const { data: panel, loading } = useFetch(
    () => panelApi.get({ region: 'R4A', from: '2018-10', to: '2019-12' }),
    [],
  )

  /* The lead-time table: each month's cases beside the temperature three
     months earlier, which is the lag the panel actually shows signal at. */
  const leadTime = useMemo(() => {
    const rows = panel ?? []
    const byPeriod = new Map(rows.map((r) => [r.period, r]))
    return rows
      .filter((r) => r.year === 2019)
      .map((r) => {
        const m = r.month - 3
        const lagPeriod = m > 0
          ? `${r.year}-${String(m).padStart(2, '0')}`
          : `${r.year - 1}-${String(m + 12).padStart(2, '0')}`
        return {
          period: r.period,
          monthName: MONTHS[r.month - 1],
          cases: toNumber(r.confirmed_cases),
          tempLag3: toNumber(byPeriod.get(lagPeriod)?.temperature),
          lagLabel: lagPeriod,
        }
      })
  }, [panel])

  const peakCases = leadTime.reduce((a, b) => (b.cases > (a?.cases ?? -1) ? b : a), null)
  const peakTemp = leadTime.reduce((a, b) => ((b.tempLag3 ?? -1) > (a?.tempLag3 ?? -1) ? b : a), null)
  const maxCases = Math.max(...leadTime.map((r) => r.cases ?? 0), 1)

  return (
    <>
      <PageHeader
        title="Mathematical calculation"
        description="How every number in this app is computed — and, for each one, the decision it is supposed to change. If a formula changes no decision, it does not belong in an early-warning system."
      />

      <div className="notice notice-info" style={{ marginBottom: 'var(--sp-5)' }}>
        <Icon name="info" size={15} />
        <span>
          The worked figures below are real values read from the loaded panel.
          The model metrics on{' '}
          <Link to="/models">Model comparison</Link>,{' '}
          <Link to="/calibration">Calibration</Link> and{' '}
          <Link to="/drivers">Drivers</Link> are still demo fixtures until the
          Python model service runs.
        </span>
      </div>

      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHead
          title="Where the arithmetic happens"
          description="This app displays. It does not compute the model. Knowing which is which matters when a number looks wrong."
        />
        <CardBody>
          <ol className="math-chain">
            <li>
              <span className="math-chain-step">1</span>
              <span className="math-chain-text">
                <strong>Surveillance and climate</strong>
                <span>17 regions × 60 months, joined into one panel</span>
              </span>
            </li>
            <li>
              <span className="math-chain-step">2</span>
              <span className="math-chain-text">
                <strong>Lagged features</strong>
                <span>this month's cases explained by earlier months' weather</span>
              </span>
            </li>
            <li>
              <span className="math-chain-step is-model">3</span>
              <span className="math-chain-text">
                <strong>Model → a distribution</strong>
                <span>Python service · the only step that fits anything</span>
              </span>
            </li>
            <li>
              <span className="math-chain-step">4</span>
              <span className="math-chain-text">
                <strong>Scores written to MySQL</strong>
                <span>RMSE, CRPS, coverage, PIT, effects</span>
              </span>
            </li>
            <li>
              <span className="math-chain-step">5</span>
              <span className="math-chain-text">
                <strong>This app reads them</strong>
                <span>it recomputes only a gap, a ratio and a sort order</span>
              </span>
            </li>
          </ol>
        </CardBody>
        <CardFoot>
          The database is the boundary. Everything on Model comparison,
          Calibration and Drivers was calculated before it reached the browser.
        </CardFoot>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Section
        n="1"
        title="The output is a distribution, not a number"
        lead="This is the whole reason for the Bayesian half of the hybrid."
      >
        <p>
          A conventional forecast returns one number. This model returns a
          probability distribution over how many cases a region will see —
          every plausible outcome, each with a weight.
        </p>

        <Formula label="The predictive distribution" note="ŷ is the forecast, x the lagged predictors">
          {`<math display="block">
            <mi>p</mi><mo>(</mo><mi>y</mi><mo>&#8739;</mo><mi mathvariant="bold">x</mi><mo>)</mo>
            <mspace width="1.2em"/><mo>&#10230;</mo><mspace width="1.2em"/>
            <mo>[</mo><mi>&#8467;</mi><mo>,</mo><mspace width="0.2em"/><mi>u</mi><mo>]</mo>
            <mspace width="0.6em"/><mtext>such that</mtext><mspace width="0.6em"/>
            <mi>P</mi><mo>(</mo><mi>&#8467;</mi><mo>&#8804;</mo><mi>y</mi><mo>&#8804;</mo><mi>u</mi><mo>)</mo>
            <mo>=</mo><mn>0.95</mn>
          </math>`}
        </Formula>

        <p>
          A point forecast tells you what to <em>expect</em>. A distribution
          tells you what to <em>prepare for</em> — and those are different
          numbers. Expecting 4,000 cases while the 95% upper bound is 9,400
          means the plan has to survive 9,400.
        </p>

        <Changes>
          Vector-control stock, ward capacity and staffing are sized on the
          upper bound, not the mean. A point forecast cannot produce an upper
          bound at all, so a health officer using one is implicitly planning
          for the average month — the one month an outbreak is not.
        </Changes>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        n="2"
        title="Where the warning actually comes from"
        lead="Lead time is the product. Without a lag there is no warning, only a report."
        foot="Real values from the loaded panel — CALABARZON (R4A), 2019. Temperature is the regional monthly mean three months before each case month."
      >
        <p>
          Dengue does not respond to today's weather. Warmth accelerates
          mosquito development and shortens the virus's incubation inside the
          vector; the cases that result are reported months later. In this
          panel the strongest single relationship is temperature at a{' '}
          <strong>three-month lag</strong> — within-region correlation{' '}
          <strong>r = 0.398</strong>, against 0.06 at lag 0.
        </p>

        {loading && !leadTime.length ? (
          <SkeletonRows rows={5} />
        ) : (
          <div className="math-leadtime">
            <div className="lt-head" aria-hidden="true">
              <span>2019</span>
              <span className="lt-head-temp">Temp &minus;3&thinsp;mo</span>
              <span>Confirmed cases</span>
              <span />
            </div>
            {leadTime.map((r) => {
              const isPeakCases = peakCases && r.period === peakCases.period
              const isPeakTemp = peakTemp && r.period === peakTemp.period
              return (
                <div className="lt-row" key={r.period}>
                  <span className="lt-month">{r.monthName}</span>
                  <span className={`lt-temp ${isPeakTemp ? 'is-peak' : ''}`}>
                    {r.tempLag3 !== null ? `${formatNumber(r.tempLag3, { decimals: 2 })}°` : '—'}
                  </span>
                  <span className="lt-bar-track">
                    <span
                      className={`lt-bar ${isPeakCases ? 'is-peak' : ''}`}
                      style={{ width: `${((r.cases ?? 0) / maxCases) * 100}%` }}
                    />
                  </span>
                  <span className="lt-cases">{formatInt(r.cases)}</span>
                </div>
              )
            })}
          </div>
        )}

        {peakTemp && peakCases && (
          <p className="math-callout">
            The year's warmest month at this lag was{' '}
            <strong>{MONTHS[Number(peakTemp.lagLabel.slice(5)) - 1]} {peakTemp.lagLabel.slice(0, 4)}</strong>{' '}
            ({formatNumber(peakTemp.tempLag3, { decimals: 2 })}°C). The case
            peak — <strong>{formatInt(peakCases.cases)} cases</strong> — arrived
            in <strong>{peakCases.monthName}</strong>, three months later.
          </p>
        )}

        <Changes>
          Three months is the difference between preparing and reacting.
          Fogging, larval source reduction and stockpiling all need weeks of
          notice; a nowcast that tells you cases are rising the month they rise
          is too late to change the outcome. The lag structure is the early
          warning — everything else on this page is a check on whether that
          warning can be trusted.
        </Changes>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        n="3"
        title="Is the forecast close?"
        lead="Point accuracy — Model comparison, panel 1."
      >
        <Formula label="Root mean squared error">
          {`<math display="block">
            <mi>RMSE</mi><mo>=</mo>
            <msqrt><mrow>
              <mfrac><mn>1</mn><mi>n</mi></mfrac>
              <munderover><mo>&#8721;</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover>
              <msup><mrow><mo>(</mo>
                <msub><mover accent="true"><mi>y</mi><mo>&#94;</mo></mover><mi>i</mi></msub>
                <mo>&#8722;</mo><msub><mi>y</mi><mi>i</mi></msub>
              <mo>)</mo></mrow><mn>2</mn></msup>
            </mrow></msqrt>
          </math>`}
        </Formula>

        <Formula label="Mean absolute error">
          {`<math display="block">
            <mi>MAE</mi><mo>=</mo>
            <mfrac><mn>1</mn><mi>n</mi></mfrac>
            <munderover><mo>&#8721;</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover>
            <mrow><mo>&#8739;</mo>
              <msub><mover accent="true"><mi>y</mi><mo>&#94;</mo></mover><mi>i</mi></msub>
              <mo>&#8722;</mo><msub><mi>y</mi><mi>i</mi></msub>
            <mo>&#8739;</mo></mrow>
          </math>`}
        </Formula>

        <p>
          Both are in cases. They differ in what they punish: MAE treats a
          100-case miss the same wherever it happens, while RMSE squares the
          error, so one 5,000-case miss costs it more than fifty 100-case
          misses.
        </p>

        <Changes>
          For outbreak detection, RMSE is the more honest headline. The months
          that matter are exactly the large ones — September 2019 was 21,658
          cases against a January of 2,157 — and a metric that lets a model
          smooth through the peak while scoring well on the quiet months is
          measuring the wrong thing.
        </Changes>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        n="4"
        title="Is the uncertainty honest?"
        lead="Interval reliability — Calibration."
      >
        <Formula label="Empirical coverage" note="the share of months that actually landed inside the stated interval">
          {`<math display="block">
            <mover accent="true"><mi>c</mi><mo>&#94;</mo></mover>
            <mo>=</mo>
            <mfrac><mn>100</mn><mi>n</mi></mfrac>
            <munderover><mo>&#8721;</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover>
            <mn>1</mn><mo>{</mo>
            <msub><mi>&#8467;</mi><mi>i</mi></msub><mo>&#8804;</mo>
            <msub><mi>y</mi><mi>i</mi></msub><mo>&#8804;</mo>
            <msub><mi>u</mi><mi>i</mi></msub>
            <mo>}</mo>
          </math>`}
        </Formula>

        <Formula label="Sharpness — mean interval width">
          {`<math display="block">
            <mover accent="true"><mi>w</mi><mo>&#175;</mo></mover>
            <mo>=</mo>
            <mfrac><mn>1</mn><mi>n</mi></mfrac>
            <munderover><mo>&#8721;</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover>
            <mrow><mo>(</mo>
              <msub><mi>u</mi><mi>i</mi></msub><mo>&#8722;</mo>
              <msub><mi>&#8467;</mi><mi>i</mi></msub>
            <mo>)</mo></mrow>
          </math>`}
        </Formula>

        <p>
          These two must be read together, always. Coverage alone is trivially
          gamed: an interval of [0, 500,000] covers every month perfectly and
          tells a health officer nothing. Sharpness alone is worse — a very
          narrow interval that is usually wrong.
        </p>

        <Changes>
          A 95% interval is a promise: <em>you will be caught out about one
          month in twenty</em>. If its empirical coverage is 78%, the real rate
          is closer to one month in four and a half. A district that sized its
          surge capacity on that band would be overrun four times as often as
          its own plan said. That gap — not the RMSE — is what decides whether
          the forecast is safe to act on.
        </Changes>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        n="5"
        title="Is the whole distribution right?"
        lead="Distributional accuracy and calibration — CRPS and the PIT histogram."
      >
        <Formula label="Continuous ranked probability score">
          {`<math display="block">
            <mi>CRPS</mi><mo>(</mo><mi>F</mi><mo>,</mo><mi>y</mi><mo>)</mo><mo>=</mo>
            <msubsup><mo>&#8747;</mo><mrow><mo>&#8722;</mo><mi>&#8734;</mi></mrow><mi>&#8734;</mi></msubsup>
            <msup><mrow><mo>(</mo>
              <mi>F</mi><mo>(</mo><mi>x</mi><mo>)</mo><mo>&#8722;</mo>
              <mn>1</mn><mo>{</mo><mi>x</mi><mo>&#8805;</mo><mi>y</mi><mo>}</mo>
            <mo>)</mo></mrow><mn>2</mn></msup>
            <mspace width="0.2em"/><mi>d</mi><mi>x</mi>
          </math>`}
        </Formula>

        <p>
          CRPS scores the entire predicted distribution against the one number
          that actually happened. Its useful property: for a forecast that is
          just a single number, CRPS collapses to <strong>MAE</strong>. That
          makes it a fair common currency — SARIMA and LSTM can be scored on it
          without owning a distribution, and the hybrid has to beat their MAE
          to justify producing one.
        </p>

        <Formula label="Randomised PIT — required for counts" note="v ~ Uniform(0,1); F is the predictive CDF">
          {`<math display="block">
            <msub><mi>u</mi><mi>i</mi></msub><mo>=</mo>
            <msub><mi>F</mi><mi>i</mi></msub><mo>(</mo>
              <msub><mi>y</mi><mi>i</mi></msub><mo>&#8722;</mo><mn>1</mn>
            <mo>)</mo>
            <mo>+</mo>
            <msub><mi>v</mi><mi>i</mi></msub>
            <mrow><mo>[</mo>
              <msub><mi>F</mi><mi>i</mi></msub><mo>(</mo><msub><mi>y</mi><mi>i</mi></msub><mo>)</mo>
              <mo>&#8722;</mo>
              <msub><mi>F</mi><mi>i</mi></msub><mo>(</mo><msub><mi>y</mi><mi>i</mi></msub><mo>&#8722;</mo><mn>1</mn><mo>)</mo>
            <mo>]</mo></mrow>
          </math>`}
        </Formula>

        <p>
          The PIT histogram asks where each observation fell inside its own
          predicted distribution. If the model is right, those positions are
          uniform and the histogram is flat. A U shape means overconfidence —
          too many months landing in the tails.
        </p>

        <div className="notice notice-warning">
          <Icon name="warning" size={15} />
          <span>
            Case counts are <strong>integers</strong>, and the plain PIT is not
            uniform for a discrete distribution even when the model is perfectly
            specified. Using it here would show miscalibration that is not
            there. The randomised form above is the one to compute.
          </span>
        </div>

        <Changes>
          Coverage checks one promise at one level. The PIT checks the shape of
          the whole distribution, which is what catches a model that gets the
          95% band right by accident while systematically misjudging the middle.
          For an early-warning system this is the difference between "the alarm
          threshold is trustworthy" and "the alarm threshold happens to work at
          one setting".
        </Changes>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        n="6"
        title="What is driving the forecast?"
        lead="Interpretability — Drivers."
      >
        <Formula label="Posterior effect and its credible interval">
          {`<math display="block">
            <msub><mover accent="true"><mi>&#946;</mi><mo>&#94;</mo></mover><mi>j</mi></msub>
            <mo>=</mo>
            <mi>E</mi><mo>[</mo><msub><mi>&#946;</mi><mi>j</mi></msub>
            <mo>&#8739;</mo><mi mathvariant="bold">y</mi><mo>]</mo>
            <mspace width="1.6em"/>
            <mo>[</mo><msub><mi>&#8467;</mi><mi>j</mi></msub><mo>,</mo>
            <msub><mi>u</mi><mi>j</mi></msub><mo>]</mo>
            <mo>=</mo>
            <mo>[</mo><msub><mi>q</mi><mn>0.025</mn></msub><mo>,</mo>
            <msub><mi>q</mi><mn>0.975</mn></msub><mo>]</mo>
          </math>`}
        </Formula>

        <Formula label="The honesty test the Drivers page applies">
          {`<math display="block">
            <mtext>no detectable effect</mtext>
            <mspace width="0.6em"/><mo>&#8660;</mo><mspace width="0.6em"/>
            <mn>0</mn><mo>&#8712;</mo>
            <mo>[</mo><msub><mi>&#8467;</mi><mi>j</mi></msub><mo>,</mo>
            <msub><mi>u</mi><mi>j</mi></msub><mo>]</mo>
          </math>`}
        </Formula>

        <p>
          Because the model is Bayesian, every coefficient arrives as a
          distribution rather than a single fitted value. The interval is not
          decoration — it is what separates "this factor matters" from "we
          cannot tell".
        </p>

        <Changes>
          A driver with a large effect and a tight interval is actionable:
          temperature at three months means a heat spell is a reason to
          pre-position resources. A driver whose interval spans zero is not,
          however high it would rank on effect size alone. Acting on one would
          spend budget on a relationship the data does not support — which is
          precisely the interpretability failure this study exists to address.
        </Changes>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Card className="section-gap">
        <CardHead
          title="7 · What these numbers cannot tell you"
          description="Stated here so the page is not read as a warranty."
        />
        <DataTable
          caption="Limits of the current evaluation"
          rows={[
            {
              limit: 'Nothing about 2020',
              why: 'July–October 2020 ran at 6–9% of 2019 because COVID lockdowns collapsed surveillance reporting, not transmission. The model is neither trained nor scored on it.',
            },
            {
              limit: 'Little about small regions',
              why: 'The panel has 17 regions. A predictor that only varies between regions — population density — has almost no statistical power here, so "no detectable effect" may mean "not enough regions".',
            },
            {
              limit: 'Nothing causal',
              why: 'A credible interval excluding zero says the association is reliable in this data. It does not license the claim that changing the predictor would change cases.',
            },
            {
              limit: 'Nothing below regional level',
              why: 'A forecast for CALABARZON as a whole does not tell a mayor in Imus what to expect. Municipal geography exists on the risk map but only as annual totals.',
            },
            {
              limit: 'Nothing about reporting delay',
              why: 'The target is cases as recorded, not cases as they occurred. A change in reporting practice moves the forecast without any change in transmission.',
            },
          ]}
          getRowKey={(r) => r.limit}
          columns={[
            { key: 'limit', header: 'Limit', className: 'cell-strong', width: '28%' },
            { key: 'why', header: 'Why', render: (r) => <span className="subtle">{r.why}</span> },
          ]}
        />
        <CardFoot>
          Full derivations and the exact write contract for each quantity are in
          markdown/MODEL_SERVICE.md. The pages these formulas feed are{' '}
          <Link to="/models">Model comparison</Link>,{' '}
          <Link to="/calibration">Calibration</Link> and{' '}
          <Link to="/drivers">Drivers</Link>.
        </CardFoot>
      </Card>
    </>
  )
}
