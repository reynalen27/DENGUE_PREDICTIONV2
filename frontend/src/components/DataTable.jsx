/*
 * columns: [{ key, header, align, width, render(row), className }]
 * Numeric columns get tabular-nums and right alignment so digits line up.
 */
export default function DataTable({ columns, rows, getRowKey, caption, emptyLabel = 'No rows' }) {
  return (
    <div className="table-scroll">
      <table className="table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={col.align === 'right' ? 'num' : undefined}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="cell-quiet">{emptyLabel}</td>
            </tr>
          )}
          {rows.map((row, i) => (
            <tr key={getRowKey ? getRowKey(row, i) : i}>
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={[col.align === 'right' ? 'num' : '', col.className ?? ''].join(' ').trim() || undefined}
                >
                  {col.render ? col.render(row, i) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
