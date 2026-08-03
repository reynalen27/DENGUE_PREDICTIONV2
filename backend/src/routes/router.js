// Minimal router replacing Express: matches method + path (with :params)
// against registered handlers. Each handler receives (req, res) where
// req.params and req.query are pre-populated.
export class Router {
  constructor() {
    this.routes = []
  }

  add(method, pattern, handler) {
    const paramNames = []
    const regexPath = pattern
      .split('/')
      .map((segment) => {
        if (segment.startsWith(':')) {
          paramNames.push(segment.slice(1))
          return '([^/]+)'
        }
        return segment
      })
      .join('/')
    const regex = new RegExp(`^${regexPath}$`)
    this.routes.push({ method, regex, paramNames, handler })
  }

  get(pattern, handler) { this.add('GET', pattern, handler) }
  post(pattern, handler) { this.add('POST', pattern, handler) }
  put(pattern, handler) { this.add('PUT', pattern, handler) }
  delete(pattern, handler) { this.add('DELETE', pattern, handler) }

  // Returns true if a route matched (and was handled), false otherwise.
  async handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const pathname = url.pathname

    for (const route of this.routes) {
      if (route.method !== req.method) continue
      const match = pathname.match(route.regex)
      if (!match) continue

      const params = {}
      route.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1])
      })
      req.params = params
      req.query = Object.fromEntries(url.searchParams)

      await route.handler(req, res)
      return true
    }
    return false
  }
}
