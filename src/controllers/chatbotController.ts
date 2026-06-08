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

    /**
     * Streaming endpoint using Server-Sent Events (SSE)
     * Returns real-time streaming response for better UX
     */
    public runAgentStream = async (req: MulterRequest, res: Response) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            const prompt = req.body?.prompt;
            if (!prompt) {
                res.status(400).json({ message: 'Prompt is required' });
                return;
            }

            let image: string | undefined;
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

            // Set up SSE headers
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
            res.flushHeaders();

            // Send initial "thinking" event
            res.write(
                `event: thinking\ndata: ${JSON.stringify({ status: 'thinking' })}\n\n`
            );

            // Get full response from agent
            const result = await flashcardAgent.run(
                enhancedPrompt,
                userId,
                image
            );

            // Stream the message character by character for typing effect
            const message = (result as { message?: string }).message || '';
            const chunkSize = 3; // Send 3 characters at a time for faster streaming

            for (let i = 0; i < message.length; i += chunkSize) {
                const chunk = message.slice(i, i + chunkSize);
                res.write(
                    `event: chunk\ndata: ${JSON.stringify({ text: chunk, index: i })}\n\n`
                );
                // Small delay for typing effect (10ms per chunk)
                await new Promise((resolve) => setTimeout(resolve, 10));
            }

            // Send final complete response with payload
            res.write(`event: complete\ndata: ${JSON.stringify(result)}\n\n`);

            // Close the stream
            res.write(
                `event: done\ndata: ${JSON.stringify({ status: 'done' })}\n\n`
            );
            res.end();
        } catch (error) {
            console.error('Error in streaming agent:', error);
            // Send error event
            res.write(
                `event: error\ndata: ${JSON.stringify({
                    error: 'Failed to process request',
                    message:
                        error instanceof Error
                            ? error.message
                            : 'Unknown error',
                })}\n\n`
            );
            res.end();
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
