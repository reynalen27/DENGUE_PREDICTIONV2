export function Card({ children, className = '', ...rest }) {
  return (
    <section className={`card ${className}`} {...rest}>
      {children}
    </section>
  )
}

export function CardHead({ title, description, actions, id }) {
  return (
    <header className="card-head">
      <div className="card-head-text">
        <h2 className="card-title" id={id}>{title}</h2>
        {description && <p className="card-desc">{description}</p>}
      </div>
      {actions && <div className="card-head-actions">{actions}</div>}
    </header>
  )
}

export function CardBody({ children, flush = false, className = '' }) {
  return <div className={`card-body ${flush ? 'card-body-flush' : ''} ${className}`}>{children}</div>
}

export function CardFoot({ children }) {
  return <footer className="card-foot">{children}</footer>
}

export default Card
