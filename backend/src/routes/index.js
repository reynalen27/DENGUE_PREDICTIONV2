import { Router } from './router.js'
import { listRegions } from '../controllers/regionsController.js'
import { listCases, bulkInsertCases } from '../controllers/casesController.js'
import { listAnnualCases } from '../controllers/surveillanceController.js'
import { getPredictionsForRegion } from '../controllers/predictionsController.js'
import { compareModels } from '../controllers/modelsController.js'
import { listAlerts } from '../controllers/alertsController.js'
import { login } from '../controllers/authController.js'

export const router = new Router()

router.get('/api/regions', listRegions)

router.get('/api/cases', listCases)
router.get('/api/cases/annual', listAnnualCases)
router.post('/api/cases/bulk', bulkInsertCases)

router.get('/api/predictions/:regionId', getPredictionsForRegion)

router.get('/api/models/compare', compareModels)

router.get('/api/alerts', listAlerts)

router.post('/api/auth/login', login)
