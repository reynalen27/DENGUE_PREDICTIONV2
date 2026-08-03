# Research data assessment

An audit of `RESEARCH DATA SET/` against what the Bayesian-neural hybrid model
needs. Every number below was computed from the files, not estimated.

**Headline:** the climate, population and gazetteer data are genuinely useful
and can go into the schema today. The dengue case data **cannot train the model
as specified** — it is annual, and the model forecasts weekly with credible
intervals. That is a sourcing problem, not a modelling one, and it is the single
thing worth fixing first.

---

## 1. What is actually in the folder

| Source | Shape | Period | Granularity | Verdict |
|---|---|---|---|---|
| `DENGUE DATA.xlsx` | 5 sheets, ~140 LGUs each | 2020–2024 | **Annual**, per LGU, by sex + outcome | Blocking gap |
| `DENGUE-CASES-...-2020..2024.pdf` | 5 PDFs, 2pp each | 2020–2024 | Same data, **plus province tables** | Recovers a lost key |
| `PAGASA .../*.csv` | 6 stations × 60 rows | 2020–2024 | **Monthly** | Directly usable |
| `Population Per Municipality.xlsx` | 142 LGUs | 2000/2010/2015/2020 | Census points | Directly usable |
| `Human Development Index/*.xlsx` | 5 provinces × 1 value | 2009, 2012 | Provincial | Largely unusable |

---

## 2. The blocking gap: annual cases vs a weekly model

The whole dataset gives you **five case observations per municipality** —
one per year, 2020 to 2024.

```
dengue cases   |----2020----|----2021----|----2022----|----2023----|----2024----|
               ^            ^            ^            ^            ^
               5 observations per LGU, total

climate        |||||||||||| |||||||||||| |||||||||||| |||||||||||| ||||||||||||
               60 monthly observations per station
```

Regional totals after repairing the transcription errors in §4:

| Year | Batangas | Cavite | Laguna | Quezon | Rizal | **CALABARZON** |
|---|---:|---:|---:|---:|---:|---:|
| 2020 | 1,157 | 3,045 | 1,910 | 809 | 2,012 | **8,933** |
| 2021 | 1,876 | 2,729 | 2,369 | 437 | 2,817 | **10,228** |
| 2022 | 3,032 | 5,786 | 7,189 | 3,747 | 5,426 | **25,180** |
| 2023 | 1,717 | 4,685 | 4,277 | 4,623 | 8,286 | **23,588** |
| 2024 | 4,693 | 14,261 | 8,857 | 6,844 | 11,848 | **46,503** |

Reproduce with `cd backend && npm run etl -- --dry-run`.

Why five points per unit is not enough:

- **A credible interval needs a likelihood over repeated observations.** With
  n=5 per LGU the posterior is dominated by the prior. The interval you would
  publish would be a statement about your prior, not about dengue.
- **There is no seasonality to learn.** Dengue in the Philippines is driven by
  the wet season. Annual totals integrate that away completely — the signal the
  model exists to capture is not present in the data at all.
- **The neural half has nothing to fit.** A GRU or LSTM over a length-5 sequence
  is not a sequence model.

### The correlations confirm it

Joining annual cases to annual climate — every row you can build today:

```
rows = 20   (4 provinces × 5 years; Laguna has no weather station)

cases ~ rainfall     r = -0.16
cases ~ mean temp    r = -0.10
cases ~ humidity     r = -0.12
```

**Do not read this as "climate doesn't predict dengue."** It is an artefact of
annual aggregation. The seasonality is plainly there in the monthly climate —
a six-fold wet/dry swing:

```
month   mean rainfall across all 6 stations, 2020–2024
 Jan    206.9 mm  #############
 Feb    116.0 mm  #######
 Mar     81.3 mm  #####          <- dry season trough
 Apr     93.8 mm  ######
 May    186.8 mm  ############
 Jun    212.7 mm  ##############
 Jul    375.3 mm  #########################
 Aug    225.5 mm  ###############
 Sep    317.6 mm  #####################
 Oct    489.3 mm  ################################   <- peak
 Nov    348.7 mm  #######################
 Dec    423.6 mm  ############################
```

The predictor has the signal. The response has been averaged flat. Pairing them
at annual resolution throws away the only relationship worth modelling.

### What to request

The five PDFs are issued by **DOH Center for Health Development – CALABARZON**,
and they are year-end summaries compiled from that office's routine
morbidity-week surveillance. The underlying weekly or monthly counts therefore
exist upstream of these files. Requesting **case counts by LGU by morbidity
week, 2016–2024**, from the same office would take the dataset from 5
observations per LGU to roughly 470 — which is a trainable series, and long
enough for a hold-out evaluation window that means something.

Until that arrives, everything below is still worth doing: it is the other 80%
of the pipeline, and it will be ready when the case data lands.

---

## 3. What you can integrate today

The existing schema already has the right tables. Three of them can be filled
from this folder now.

### `regions` — replace the 4 demo rows with the real 142

The population workbook is a clean **PSA gazetteer**: 142 cities and
municipalities across the five provinces.

| Province | LGUs | Population (2020) |
|---|---:|---:|
| Batangas | 34 | 2,908,494 |
| Cavite | 23 | 4,344,829 |
| Laguna | 30 | 3,382,193 |
| Quezon \* | 41 | 1,950,459 |
| Rizal | 14 | 3,330,143 |
| Lucena City | *(1, counted in Quezon's 41)* | 278,924 |
| **Region IV-A** | **142** | **16,195,042** |

\* The workbook labels the province row `QUEZON *`; the asterisk means the
figure **excludes Lucena City**, which PSA reports separately as a highly
urbanised city. The five province rows sum to 15,916,118 — exactly 278,924
short of the regional total, which is Lucena. Anything that aggregates province
rows must add Lucena back or it loses a quarter-million people.

The dengue sheets cover all of them: **141 distinct name keys matched, 134
present in all five years** (the 142→141 collapse is the Rosario collision in
§4). Per year: 138 / 135 / 140 / 141 / 140.

This alone makes the app real — the sidebar, forecast selector and alerts table
would be working against actual CALABARZON LGUs instead of four placeholders.

### `climate_data` — the PAGASA monthly series fits the schema exactly

The table already has `temperature`, `rainfall`, `humidity`. Six stations,
60 clean monthly rows each (after fixing §4's sentinel), 2020–2024.

Station → province, as the geography dictates:

| Station | Province | Annual rainfall | Mean temp |
|---|---|---:|---:|
| Sangley Point | Cavite | ~1,800 mm | 29.4 °C |
| Ambulong | Batangas | ~1,960 mm | 28.1 °C |
| Tanay | Rizal | ~2,950 mm | 23.7 °C |
| Alabat, Infanta, Tayabas | Quezon | ~11,700 mm (3-station sum) | 27.4 °C |
| **— none —** | **Laguna** | — | — |

> **Laguna has no station.** It is the second-most-populous province in the
> region (3.4 M) and carried 8,857 cases in 2024. Nearest usable proxies are
> Ambulong (Tanauan, Batangas — adjacent to Laguna's south) and Tanay (Rizal —
> adjacent to the north-east). Either is a modelling assumption that must be
> declared, or request the Los Baños / Calamba PAGASA series to close it
> properly.

Note the spread is real, not noise: Tanay averages **23.7 °C** against Sangley
Point's **29.4 °C** — a 5.7 °C gap across a region 100 km wide, driven by
elevation. That is exactly the kind of cross-sectional variation a hierarchical
Bayesian model can exploit, and it argues for province-level (or finer) random
effects rather than a single regional model.

### `demographic_data` — census population as the exposure offset

The table has `region_id, year, population, urban_pct, poverty_rate`. The
census gives four anchor points (2000, 2010, 2015, 2020) plus PSA's own
inter-censal growth rates, so annual population is a straightforward
interpolation.

This matters more than it looks: raw counts are not comparable across LGUs.
Per-100k rates reorder the ranking substantially —

| Province | 2024 cases | 2024 per 100k |
|---|---:|---:|
| Cavite | 14,261 | 328.2 |
| Rizal | 11,848 | **355.8** |
| Laguna | 8,857 | 261.9 |
| Quezon | 6,844 | 307.0 |
| Batangas | 4,693 | 161.4 |

Cavite leads on volume; **Rizal leads on incidence**. An early-warning system
that ranks by raw count sends resources to the wrong province. In the model,
`log(population)` belongs as an offset term, not a free covariate.

---

## 4. Data quality defects — fix these before any join

These are real and every one of them will silently corrupt results.

### 4a. `-999` missing-data sentinel, not `NA`

**`Ambulong Monthly Data.csv`, 2020-01** — every measurement is `-999`:

```csv
YEAR,MONTH,RAINFALL,TMAX,TMIN,TMEAN,RH
2020,1,-999.0,-999.0,-999.0,-999.0,-999
```

`pandas.read_csv` reports **zero** nulls for this file because `-999` is a
valid number. Loaded naively it drags Ambulong's 2020 mean temperature down by
roughly 4 °C. Replace with `NA` on load; it is the only such row in all six
files.

### 4b. Eleven OCR corruptions in the municipality names

The XLSX was transcribed from the PDFs and carries OCR damage. Left as-is, each
becomes a phantom municipality that never joins:

| In the workbook | Should be | Year(s) |
|---|---|---|
| `AGONCILLA` | Agoncillo | 2020 |
| `CALAUJAG` | Calauag | 2020 |
| `CABUAYAO` | Cabuyao | 2022 |
| `LIUW` | Liliw | 2022 |
| `MATAAS NA KAOY` | Mataasnakahoy | 2022 |
| `MATAAS NA KAOYO` | Mataasnakahoy | 2021 |
| `MATAAS NA KAHOY` | Mataasnakahoy | 2020, 2023 |
| `UMACA` | Gumaca | 2023 |
| `UNIAN` | Unisan | 2023 |
| `TIINGLOY` | Tingloy | 2023 |
| `TAKAWANAN` | Tagkawayan | 2023 |

Mataasnakahoy alone appears under **four different spellings** across five
sheets. Before repair only **116 of 152** name variants carried a value in all
five years; after repair, **134 of 141** LGUs form a complete panel.

### 4c. The province column was lost in transcription — but it is recoverable

The PDFs are organised as one table per province (*Table 1. Cavite, Table 2.
Laguna, Table 3. Batangas, Table 4. Rizal…*). The XLSX flattens all provinces
into one list and **drops the province**. Municipality name alone is not a
unique key:

> **Rosario exists in both Batangas (pop 128,352) and Cavite (pop 110,807).**
> It appears twice in every sheet, unlabelled: 2024 shows `ROSARIO 462` and
> `ROSARIO 111` with nothing to say which is which.

Here is the damage a naive join does, measured: building the Cavite LGU list
keyed on name alone sums to **4,234,022** against the census province total of
**4,344,829** — short by **110,807**, which is precisely Rosario, Cavite. One
silently dropped municipality, and its cases misattributed to Batangas.

**The flattening preserved the PDFs' ordering, so the province can be
recovered without re-extracting anything.** Each sheet turns out to be five
blocks of municipalities separated by blank rows. Assigning each block the
province that the majority of its unambiguously-named members belong to
resolves **every block at 100% purity on all five sheets**, and the block sizes
match the PSA counts exactly:

| Sheet | Block sizes (Cavite, Laguna, Batangas, Rizal, Quezon) |
|---|---|
| 2020 | 23, 30, 34, 14, 38 |
| 2021 | 23, 30, 34, 14, 38 |
| 2022 | 23, 30, 34, 14, 40 |
| 2023 | 23, 30, 34, 14, 42 |
| 2024 | 23, 31, 34, 14, 41 |

That is what finally splits Rosario: one row in block 1 (Cavite, 80 cases in
2020) and one in block 3 (Batangas, 97). This is implemented in
`backend/scripts/etl/sources.js` and the purity check runs on every ETL pass,
so a future sheet that breaks the layout fails loudly instead of quietly
misfiling a province.

### 4d. Duplicate and blank rows

| Sheet | Issue | Effect |
|---|---|---|
| 2024 | `LUCENA CITY 827` and `Lucena City 827` — same value twice | +827 double-count if not deduped |
| 2023 | `LUCENA CITY 268` and `CITY OF LUCENA 167` — **different** values | Quezon 2023 is wrong by 167 or 268; unresolvable from this file |
| 2024 | `SANTA CRUZ 95` and `SANTA CRUZ 15` — only one Santa Cruz in IV-A | One is spurious |
| 2021 | 10 LGUs present with a **blank** total | Quezon 2021 (437) is an undercount |

All ten 2021 blanks fall in one province — Quezon: General Luna, General Nakar,
Macalelon, Mulanay, Panukulan, Perez, Plaridel, Sampaloc, San Andres, San
Francisco. This is why Quezon 2021 reads 437 against 3,747 the following year —
**that drop is a reporting artefact, not an epidemiological event.** Any model
fed this will learn a crash that never happened.

---

## 5. The HDI files are not usable as a covariate

Both workbooks hold **five numbers** — one per province — and nothing else:

| Province | HDI 2009 | HDI 2012 |
|---|---:|---:|
| Batangas | 0.68 | 0.69 |
| Cavite | 0.75 | 0.77 |
| Laguna | 0.73 | 0.76 |
| Quezon | 0.52 | 0.55 |
| Rizal | 0.76 | 0.82 |

Three problems: they are **provincial**, not municipal; there are **two time
points**; and both **predate the 2020–2024 case window by 8–11 years**. PSA
stopped publishing provincial HDI after 2012, so there is no newer edition to
fetch.

They can serve as a **static province-level socioeconomic prior** — Quezon's
0.55 against Rizal's 0.82 is a real and large gap, and plausibly explains
baseline differences in reporting completeness and care-seeking. That is a
legitimate use in a hierarchical prior. What they cannot be is a time-varying
covariate, and the `demographic_data.poverty_rate` column is a better home for
something current if you can source it.

---

## 6. Gaps the schema expects but the folder does not fill

| Table / column | Status |
|---|---|
| `vector_data` (larval index, adult density) | **Nothing.** Entomological surveillance is usually the strongest short-horizon predictor. Worth asking DOH/LGU vector-control units for Ovitrap Index. |
| `climate_data.enso_index` | **Nothing.** ENSO matters for Philippine dengue at 3–6 month lags — and it is the cheapest gap to close, since NOAA publishes the ONI series openly. |
| Case data at sub-annual resolution | **Nothing.** §2. |
| Laguna weather | **Nothing.** §3. |

---

## 7. Recommended order of work

1. **Request weekly/monthly LGU case counts from DOH CHD-CALABARZON.** Everything
   else is preparation; this is the only item that unblocks the model. Ask for
   2016 onward — a longer run costs the same to request and doubles the series.
2. ~~Re-extract the dengue tables from the PDFs.~~ **Done differently** — §4b
   and §4c are both repaired in `backend/scripts/etl/`, without needing the
   PDFs. Verify the two conflicting Lucena rows (§4d) against the 2023 PDF;
   that is the one defect the workbook cannot settle on its own.
3. ~~Load `regions` + `demographic_data`.~~ **Done** — `npm run etl` loads all
   142 LGUs and the four census points.
4. ~~Load `climate_data`.~~ **Done** — `-999` → `NULL`; Laguna is left empty
   unless you pass `--laguna-proxy`, so the substitution is a recorded choice
   rather than a silent default.
5. **Backfill `enso_index`** from NOAA ONI — free, and covers a documented driver.
6. **Then** build features: lagged rainfall (1–3 months), lagged temperature,
   `log(population)` offset, province random effect with the HDI as a prior.

Items 2–4 are implemented; see [ARCHITECTURE.md](ARCHITECTURE.md) § `backend/scripts/`.

### What is honestly achievable before step 1 lands

A **province-level annual** descriptive model over 25 observations. That is a
useful validation harness — it will exercise the whole pipeline end to end and
the app will display real numbers — but it should be reported as descriptive.
It cannot support a weekly forecast, and the credible intervals it produces
would be prior-dominated. Presenting them as the study's headline result would
not survive review.

---

## Appendix — reproducing this

Everything above is produced by the committed ETL:

```bash
cd backend
npm run etl -- --dry-run     # parses, reports every defect, writes nothing
npm run etl                  # loads regions, cases, climate, demographics
npm run etl:boundaries       # builds the map's boundary file
```

The dry run prints the §2 province-year panel, the §4a sentinel, the §4d
duplicates and blanks, and the block-purity check from §4c. It is the fastest
way to confirm these findings against the files yourself.
