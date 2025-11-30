import { Router } from 'express';
import AdminTestController from '../controllers/adminTestController.js';
import multer from 'multer';

const router = Router();

// Configure multer for file upload (memory storage for Excel files)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB max file size
    },
    fileFilter: (req, file, cb) => {
        if (
            file.mimetype ===
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
            file.mimetype === 'application/vnd.ms-excel'
        ) {
            cb(null, true);
        } else {
            cb(new Error('Only Excel files are allowed'));
        }
    },
});

// CRUD Routes
router.post('/', AdminTestController.createTest);
router.get('/', AdminTestController.getAllTests);
router.get('/template', AdminTestController.downloadTemplate);
router.get('/:id', AdminTestController.getTestById);
router.put('/:id', AdminTestController.updateTest);
router.delete('/:id', AdminTestController.deleteTest);

// Excel Import/Export Routes
router.post(
    '/:id/import',
    upload.single('file'),
    AdminTestController.importFromExcel
);
router.get('/:id/export', AdminTestController.exportToExcel);

// Part Management
router.put('/:id/parts/:partNumber', AdminTestController.updatePart);

export default router;
