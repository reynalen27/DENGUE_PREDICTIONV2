/*
 * Maths rendering with no dependency.
 *
 * MathML Core is native in every browser this app targets (Chromium 109+,
 * Firefox, Safari), so formulas need no KaTeX or MathJax — which matters here
 * because the app ships zero external runtime requests.
 *
 * It goes through dangerouslySetInnerHTML on purpose. React 18 creates
 * elements in the HTML namespace, so MathML written as JSX renders as inert
 * unknown tags; letting the browser's own parser see the `<math>` element is
 * what triggers the namespace switch. The markup is static and author-written
 * — no user or database input reaches it — so there is nothing to inject.
 */
export default function Formula({ children, label, note }) {
  return (
    <figure className="formula">
      <div
        className="formula-math"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: children }}
      />
      {(label || note) && (
        <figcaption className="formula-caption">
          {label && <span className="formula-label">{label}</span>}
          {note && <span className="formula-note">{note}</span>}
        </figcaption>
      )}
    </figure>
  )
}

/** Inline maths, for a symbol mentioned mid-sentence. */
export function Inline({ children }) {
  return (
    <span
      className="formula-inline"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: children }}
    />
  )
}
