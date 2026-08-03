import http from 'node:http'
import dotenv from 'dotenv'
import { applyCors } from './middleware/cors.js'
import { router } from './routes/index.js'
import { sendJson } from './utils/http.js'

dotenv.config()
const PORT = process.env.PORT || 4000

const server = http.createServer(async (req, res) => {
  applyCors(res)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }

  try {
    const matched = await router.handle(req, res)
    if (!matched) {
      sendJson(res, 404, { error: 'Not found' })
    }
  } catch (err) {
    console.error(err)
    sendJson(res, 500, { error: 'Internal server error' })
  }
})

server.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`)
})
