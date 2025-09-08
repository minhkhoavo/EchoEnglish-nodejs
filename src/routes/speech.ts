import { Router } from 'express'
import SpeechController from '~/controllers/speech_controller'
import { uploadSingle } from '~/config/multer_config'

const router = Router()

router.post('/assess', uploadSingle, (req, res, next) => SpeechController.assess(req, res, next))

export default router
