import { useMemo, useRef, useState } from 'react'
import { useFetch } from '../hooks/useFetch.js'
import { casesApi, regionsApi } from '../services/api.js'
import { Card, CardBody, CardFoot, CardHead } from '../components/Card.jsx'
import { Notice, PageHeader, Select } from '../components/Controls.jsx'
import { AsyncSection, EmptyState, SkeletonRows } from '../components/States.jsx'
import DataTable from '../components/DataTable.jsx'
import Icon from '../components/Icon.jsx'
import { formatDate, formatInt, toNumber } from '../lib/format.js'

const REQUIRED = ['region_id', 'date', 'confirmed_cases', 'deaths']

/** Minimal CSV reader: handles CRLF, blank lines and quoted fields. */
function parseCsv(text) {
  const rows = []
  let field = ''
  let row = []
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1 } else { inQuotes = false }
      } else field += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field); field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1
      row.push(field); field = ''
      if (row.some((c) => c.trim() !== '')) rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.some((c) => c.trim() !== '')) rows.push(row)

  if (!rows.length) return { headers: [], records: [] }
  const headers = rows[0].map((h) => h.trim())
  const records = rows.slice(1).map((cells) =>
    Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? '').trim()])))
  return { headers, records }
}

export default function DataManagement() {
  const fileInput = useRef(null)
  const [regionFilter, setRegionFilter] = useState('all')
  const [dragging, setDragging] = useState(false)
  const [upload, setUpload] = useState(null) // { state, fileName, count, message }

  const { data: regions } = useFetch(() => regionsApi.list(), [])
  const { data: cases, loading, error, refetch } = useFetch(() => casesApi.list(), [])

  const regionName = useMemo(() => {
    const map = new Map((regions ?? []).map((r) => [String(r.id), r.name]))
    return (id) => map.get(String(id)) ?? `Region ${id}`
  }, [regions])

  const rows = useMemo(() => {
    const list = cases ?? []
    return regionFilter === 'all' ? list : list.filter((r) => String(r.region_id) === regionFilter)
  }, [cases, regionFilter])

  async function ingest(file) {
    if (!file) return
    setUpload({ state: 'busy', fileName: file.name, message: 'Reading file…' })

    let parsed
    try {
      parsed = parseCsv(await file.text())
    } catch {
      setUpload({ state: 'error', fileName: file.name, message: 'That file could not be read as text.' })
      return
    }

    const missing = REQUIRED.filter((c) => !parsed.headers.includes(c))
    if (missing.length) {
      setUpload({
        state: 'error',
        fileName: file.name,
        message: `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Found: ${parsed.headers.join(', ') || 'nothing'}.`,
      })
      return
    }

    if (!parsed.records.length) {
      setUpload({ state: 'error', fileName: file.name, message: 'The file has a header row but no data rows.' })
      return
    }

    setUpload({ state: 'busy', fileName: file.name, message: `Uploading ${parsed.records.length} rows…` })
    try {
      const result = await casesApi.upload(parsed.records)
      setUpload({
        state: 'ok',
        fileName: file.name,
        message: `Inserted or updated ${formatInt(result?.inserted ?? parsed.records.length)} rows.`,
      })
      refetch()
    } catch (err) {
      setUpload({
        state: 'error',
        fileName: file.name,
        message: err?.response?.data?.detail
          ?? err?.response?.data?.error
          ?? (err?.code === 'ERR_NETWORK'
            ? 'No response from the API server on port 4000.'
            : 'Upload failed. Check that every region_id exists and each date is YYYY-MM-DD.'),
      })
    }
  }

  return (
    <>
      <PageHeader
        title="Data management"
        description="Case surveillance records that feed the model. Uploads upsert on region and date, so re-uploading a corrected week overwrites it rather than duplicating it."
      />

      <div className="grid grid-split">
        <Card>
          <CardHead title="Bulk upload" description="Comma-separated values, one row per region-week." />
          <CardBody>
            <div
              className={`dropzone ${dragging ? 'is-over' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => fileInput.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.current?.click() }
              }}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                ingest(e.dataTransfer.files?.[0])
              }}
            >
              <span className="dropzone-glyph"><Icon name="upload" size={19} /></span>
              <span className="dropzone-title">Drop a CSV here, or choose a file</span>
              <span className="dropzone-sub">Parsed in the browser, then posted to /api/cases/bulk</span>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(e) => { ingest(e.target.files?.[0]); e.target.value = '' }}
              />
            </div>

            {upload && (
              <div style={{ marginTop: 'var(--sp-4)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                <span className="tag"><Icon name="file" size={12} />{upload.fileName}</span>
                <Notice tone={upload.state === 'ok' ? 'good' : upload.state === 'error' ? 'bad' : 'info'}>
                  {upload.message}
                </Notice>
              </div>
            )}
          </CardBody>
          <CardFoot>
            <dl className="deflist">
              <dt>region_id</dt><dd>Integer id from the regions table</dd>
              <dt>date</dt><dd>YYYY-MM-DD, the start of the reporting week</dd>
              <dt>confirmed_cases</dt><dd>Integer, defaults to 0</dd>
              <dt>deaths</dt><dd>Integer, defaults to 0</dd>
            </dl>
          </CardFoot>
        </Card>

        <Card>
          <CardHead title="Region ids" description="The ids the CSV's region_id column has to match." />
          <AsyncSection
            loading={!regions}
            hasData={Boolean(regions?.length)}
            isEmpty={Boolean(regions) && regions.length === 0}
            skeleton={<SkeletonRows rows={4} />}
            empty={<EmptyState icon="data" title="No regions" body="Run npm run seed in the backend to load the sample regions." />}
          >
            <DataTable
              caption="Region reference"
              rows={regions ?? []}
              getRowKey={(row) => row.id}
              columns={[
                { key: 'id', header: 'id', align: 'right', render: (r) => <span className="mono">{r.id}</span> },
                { key: 'name', header: 'Region', className: 'cell-strong' },
                { key: 'region_code', header: 'Code', render: (r) => <span className="mono cell-quiet">{r.region_code}</span> },
              ]}
            />
          </AsyncSection>
        </Card>
      </div>

      <Card className="section-gap">
        <CardHead
          title="Case records"
          description="The 500 most recent rows in case_data, newest first."
          actions={(
            <Select
              label="Region"
              hideLabel
              value={regionFilter}
              onChange={setRegionFilter}
              options={[
                { value: 'all', label: 'All regions' },
                ...(regions ?? []).map((r) => ({ value: String(r.id), label: r.name })),
              ]}
            />
          )}
        />
        <AsyncSection
          loading={loading}
          error={error}
          hasData={Boolean(cases?.length)}
          isEmpty={rows.length === 0}
          onRetry={refetch}
          errorTitle="Could not load case records"
          skeleton={<SkeletonRows rows={6} />}
          empty={cases?.length ? (
            <EmptyState icon="inbox" title="No records for this region" body="Pick another region, or upload a CSV that covers it." />
          ) : (
            <EmptyState
              icon="data"
              title="No case data yet"
              body="Upload a CSV above, or run npm run seed in the backend to load the sample weeks."
            />
          )}
        >
          <DataTable
            caption="Recent case surveillance records"
            rows={rows.slice(0, 50)}
            getRowKey={(row) => row.id}
            columns={[
              { key: 'region', header: 'Region', className: 'cell-strong', render: (r) => regionName(r.region_id) },
              { key: 'date', header: 'Week of', render: (r) => formatDate(r.date) },
              { key: 'confirmed_cases', header: 'Confirmed cases', align: 'right', render: (r) => formatInt(r.confirmed_cases) },
              {
                key: 'deaths',
                header: 'Deaths',
                align: 'right',
                render: (r) => (toNumber(r.deaths) ? formatInt(r.deaths) : <span className="cell-quiet">0</span>),
              },
            ]}
          />
        </AsyncSection>
        {rows.length > 50 && (
          <CardFoot>Showing the 50 most recent of {formatInt(rows.length)} loaded rows.</CardFoot>
        )}
      </Card>
    </>
  )
}
