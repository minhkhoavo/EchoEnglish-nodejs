import { Request, Response } from 'express';
import TestService from '../services/TestService';

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

    public async getTestByPart(req: Request, res: Response): Promise<void> {
        try {
            const { testId, partNumber } = req.params;
            const partNum = parseInt(partNumber);

            // Validate part number
            if (isNaN(partNum) || partNum < 1 || partNum > 7) {
                res.status(400).json({ message: 'Invalid part number. Must be between 1 and 7.' });
                return;
            }

            const test = await TestService.getTestByPart(testId, partNum);

            if (!test) {
                res.status(404).json({ message: 'Test or part not found' });
                return;
            }

            res.status(200).json(test);
        } catch (error) {
            console.error('Error fetching test by part:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }
}

export default new TestController();
