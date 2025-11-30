import { Request, Response } from 'express';
import AdminTestService from '../services/adminTestService.js';
import ApiResponse from '~/dto/response/apiResponse.js';
import { SuccessMessage } from '~/enum/successMessage.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';

class AdminTestController {
    /**
     * Create a new test
     */
    public createTest = async (req: Request, res: Response) => {
        const {
            testTitle,
            type,
            duration,
            number_of_questions,
            number_of_parts,
            parts,
        } = req.body;

        if (!testTitle) {
            throw new ApiError(ErrorMessage.INVALID_INPUT);
        }

        const test = await AdminTestService.createTest({
            testTitle,
            type,
            duration,
            number_of_questions,
            number_of_parts,
            parts,
        });

        return res
            .status(201)
            .json(new ApiResponse('Test created successfully', test));
    };

    /**
     * Get all tests with pagination
     */
    public getAllTests = async (req: Request, res: Response) => {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const search = req.query.search as string;

        const result = await AdminTestService.getAllTests(page, limit, search);

        return res
            .status(200)
            .json(
                new ApiResponse(SuccessMessage.GET_ALL_TESTS_SUCCESS, result)
            );
    };

    /**
     * Get test by ID
     */
    public getTestById = async (req: Request, res: Response) => {
        const { id } = req.params;
        const test = await AdminTestService.getTestById(id);

        return res
            .status(200)
            .json(new ApiResponse(SuccessMessage.GET_TEST_BY_ID_SUCCESS, test));
    };

    /**
     * Update test
     */
    public updateTest = async (req: Request, res: Response) => {
        const { id } = req.params;
        const {
            testTitle,
            duration,
            number_of_questions,
            number_of_parts,
            parts,
        } = req.body;

        const test = await AdminTestService.updateTest(id, {
            testTitle,
            duration,
            number_of_questions,
            number_of_parts,
            parts,
        });

        return res
            .status(200)
            .json(new ApiResponse('Test updated successfully', test));
    };

    /**
     * Delete test
     */
    public deleteTest = async (req: Request, res: Response) => {
        const { id } = req.params;
        await AdminTestService.deleteTest(id);

        return res
            .status(200)
            .json(new ApiResponse('Test deleted successfully', null));
    };

    /**
     * Import questions from Excel
     */
    public importFromExcel = async (req: Request, res: Response) => {
        const { id } = req.params;

        if (!req.file) {
            throw new ApiError(ErrorMessage.INVALID_INPUT);
        }

        const test = await AdminTestService.importFromExcel(
            id,
            req.file.buffer
        );

        return res
            .status(200)
            .json(new ApiResponse('Questions imported successfully', test));
    };

    /**
     * Download Excel template
     */
    public downloadTemplate = async (req: Request, res: Response) => {
        const buffer = AdminTestService.getExcelTemplate();

        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
            'Content-Disposition',
            'attachment; filename=toeic_template.xlsx'
        );

        return res.send(buffer);
    };

    /**
     * Export test to Excel
     */
    public exportToExcel = async (req: Request, res: Response) => {
        const { id } = req.params;
        const buffer = await AdminTestService.exportToExcel(id);

        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
            'Content-Disposition',
            `attachment; filename=test_${id}.xlsx`
        );

        return res.send(buffer);
    };

    /**
     * Update a specific part
     */
    public updatePart = async (req: Request, res: Response) => {
        const { id, partNumber } = req.params;
        const partData = req.body;

        const test = await AdminTestService.updatePart(
            id,
            parseInt(partNumber),
            partData
        );

        return res
            .status(200)
            .json(new ApiResponse('Part updated successfully', test));
    };
}

export default new AdminTestController();
