import axios from 'axios'

// In dev, Vite proxies /api to the Node.js server (see vite.config.js).
// In production, set VITE_API_BASE_URL to the deployed API origin.
const client = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
})

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('dews_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

export const regionsApi = {
  list: () => client.get('/regions').then((r) => r.data),
}

export const casesApi = {
  list: (regionId) => client.get('/cases', { params: { regionId } }).then((r) => r.data),
  upload: (rows) => client.post('/cases/bulk', { rows }).then((r) => r.data),
}

export const surveillanceApi = {
  // Annual cases per LGU with the census denominator attached — feeds the map.
  annual: (regionCode) =>
    client.get('/cases/annual', { params: regionCode ? { regionCode } : undefined }).then((r) => r.data),
}

export const predictionsApi = {
  forRegion: (regionId, modelRunId) =>
    client.get(`/predictions/${regionId}`, { params: { modelRunId } }).then((r) => r.data),
}

export const modelsApi = {
  compare: () => client.get('/models/compare').then((r) => r.data),
}

export const alertsApi = {
  list: () => client.get('/alerts').then((r) => r.data),
}

export const authApi = {
  login: (email, password) => client.post('/auth/login', { email, password }).then((r) => r.data),
}

export default client
