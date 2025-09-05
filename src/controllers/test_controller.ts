import { Request, Response } from 'express';
import TestService from '../services/test_service';

class TestController {
    public async getAllTests(req: Request, res: Response): Promise<void> {
        try {
            const tests = await TestService.getAllTests();
            res.status(200).json(tests);
        } catch (error) {
            console.error('Error fetching all tests:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    public async getTestById(req: Request, res: Response): Promise<void> {
        try {
            const { testId } = req.params;
            const test = await TestService.getTestById(testId);

            if (!test) {
                res.status(404).json({ message: 'Test not found' });
                return;
            }
            res.status(200).json(test);
        } catch (error) {
            console.error('Error fetching test by ID:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }
}

export default new TestController();
