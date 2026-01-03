import { Request, Response } from 'express';
import { flashcardAgent } from '~/ai/agent/chatbotAgent.js';
import { googleGenAIClient } from '~/ai/provider/googleGenAIClient.js';
import { ApiError } from '~/middleware/apiError.js';
import { User } from '~/models/userModel.js';

interface MulterRequest extends Request {
    file?: Express.Multer.File;
}

class ChatbotAgentController {
    public runAgent = async (req: MulterRequest, res: Response) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                throw new ApiError({ message: 'Unauthorized' });
            }
            let prompt: string;
            let image: string | undefined;
            prompt = req.body?.prompt;

            if (!prompt) {
                throw new ApiError({ message: 'Prompt is required' });
            }
            if (req.file) {
                const imageBuffer = req.file.buffer;
                const base64Image = imageBuffer.toString('base64');
                image = `data:${req.file.mimetype};base64,${base64Image}`;
            } else if (req.body.image) {
                image = req.body.image;
            }

            let enhancedPrompt = prompt;

            if (image) {
                enhancedPrompt = `[IMAGE PROVIDED] Please analyze the image and follow this prompt ${prompt}`;
            }

            const result = await flashcardAgent.run(
                enhancedPrompt,
                userId,
                image
            );
            return res.status(200).json(result);
        } catch (error) {
            console.error('Error executing agent:', error);
            if (error instanceof ApiError) {
                throw error;
            }
            throw new ApiError({ message: 'Failed to execute agent' });
        }
    };

    public sendMessage = async (req: Request, res: Response) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                throw new ApiError({ message: 'Unauthorized' });
            }

            const { message } = req.body;

            if (!message) {
                throw new ApiError({ message: 'Message is required' });
            }

            // Fetch user competency profile to include weak skills context
            const user = await User.findById(userId);
            let enhancedMessage = message;

            if (user?.competencyProfile?.skillMatrix) {
                // Extract weak and developing skills
                const weakSkills = user.competencyProfile.skillMatrix.filter(
                    (skill: {
                        skill: string;
                        currentAccuracy: number;
                        proficiency: string;
                    }) =>
                        skill.proficiency === 'weak' ||
                        skill.proficiency === 'developing'
                );

                if (weakSkills.length > 0) {
                    const weakSkillsList = weakSkills
                        .map(
                            (skill: {
                                skill: string;
                                currentAccuracy: number;
                                proficiency: string;
                            }) =>
                                `${skill.skill} (${skill.currentAccuracy}% accuracy)`
                        )
                        .join(', ');

                    const competencyContext = `[USER COMPETENCY PROFILE] Based on the user's learning profile, they have weaknesses in: ${weakSkillsList}. Please prioritize helping them improve these areas if relevant to their question.\n\n[USER MESSAGE] ${message}`;
                    enhancedMessage = competencyContext;
                }
            }

            // Call AI model directly to generate JSON response
            const aiResponse =
                await googleGenAIClient.generate(enhancedMessage);

            // Parse JSON from AI response
            try {
                const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const jsonResponse = JSON.parse(jsonMatch[0]);
                    return res.status(200).json(jsonResponse);
                }
            } catch (parseError) {
                console.warn(
                    'Could not parse JSON from AI response:',
                    parseError
                );
            }

            // If no JSON found, return response as-is
            return res.status(200).json({
                message: aiResponse,
                raw: true,
            });
        } catch (error) {
            console.error('Error sending message:', error);
            if (error instanceof ApiError) {
                throw error;
            }
            throw new ApiError({ message: 'Failed to send message' });
        }
    };
}

export default new ChatbotAgentController();
