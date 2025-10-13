import { Request, Response } from 'express';
import { competencyProfileService } from '../services/recommendation/CompetencyProfileService.js';
import ApiResponse from '~/dto/response/apiResponse.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';

export class CompetencyProfileController {
    async updateFromTestResult(req: Request, res: Response) {
        try {
            const { testResultId } = req.body;
            if (!req.user || !req.user.id) {
                throw new ApiError(ErrorMessage.UNAUTHORIZED);
            }
            const userId = req.user.id;

            await competencyProfileService.updateFromTestResult(
                userId,
                testResultId
            );

            res.status(200).json(
                new ApiResponse('Competency profile updated from test result')
            );
        } catch (error) {
            if (error instanceof ApiError) throw error;
            throw new ApiError(ErrorMessage.INTERNAL_ERROR);
        }
    }

    async getProfile(req: Request, res: Response) {
        try {
            if (!req.user || !req.user.id) {
                throw new ApiError(ErrorMessage.UNAUTHORIZED);
            }
            const userId = req.user.id;
            const profile = await competencyProfileService.getProfile(userId);

            res.status(200).json(
                new ApiResponse('Competency profile retrieved', profile)
            );
        } catch (error) {
            if (error instanceof ApiError) throw error;
            throw new ApiError(ErrorMessage.INTERNAL_ERROR);
        }
    }

    async getSkillProgress(req: Request, res: Response) {
        try {
            const { skillKey } = req.query;
            if (!req.user || !req.user.id) {
                throw new ApiError(ErrorMessage.UNAUTHORIZED);
            }
            const userId = req.user.id;

            if (!skillKey || typeof skillKey !== 'string') {
                throw new ApiError({
                    message: 'Skill key is required',
                    status: 400,
                });
            }

            const progress = await competencyProfileService.getSkillProgress(
                userId,
                skillKey
            );

            res.status(200).json(
                new ApiResponse('Skill progress retrieved', progress)
            );
        } catch (error) {
            if (error instanceof ApiError) throw error;
            throw new ApiError(ErrorMessage.INTERNAL_ERROR);
        }
    }

    async getWeakSkills(req: Request, res: Response) {
        try {
            if (!req.user || !req.user.id) {
                throw new ApiError(ErrorMessage.UNAUTHORIZED);
            }
            const userId = req.user.id;
            const weakSkills =
                await competencyProfileService.getWeakSkills(userId);

            res.status(200).json(
                new ApiResponse('Weak skills retrieved', weakSkills)
            );
        } catch (error) {
            if (error instanceof ApiError) throw error;
            throw new ApiError(ErrorMessage.INTERNAL_ERROR);
        }
    }
}

export const competencyProfileController = new CompetencyProfileController();
