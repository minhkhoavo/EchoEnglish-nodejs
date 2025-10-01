import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import flashcardService from '~/services/flashcardService.js';
import { FlashcardType } from '~/models/flashcardModel.js';

type SimpleFC = { id: string; front: string; back: string };

function normalizeDifficulty(v: unknown): 'Easy' | 'Medium' | 'Hard' {
    if (typeof v !== 'string') return 'Easy';
    const s = v.toLowerCase();
    if (s.startsWith('m')) return 'Medium';
    if (s.startsWith('h')) return 'Hard';
    return 'Easy';
}

const createFlashcardTool = tool(
    async (
        { front, back, category, difficulty, tags, source, isAIGenerated },
        config: RunnableConfig
    ) => {
        const userId = config?.configurable?.userId as string;
        if (!userId) throw new Error('userId required');
        const data = {
            front,
            back,
            category,
            difficulty: normalizeDifficulty(difficulty),
            tags: tags || [],
            source: source || '',
            isAIGenerated: isAIGenerated ?? false,
        };
        const fc = await flashcardService.createFlashcard(
            data as Partial<FlashcardType>,
            userId
        );
        return `Flashcard ID: ${fc._id}`;
    },
    {
        name: 'create_flashcard',
        description:
            'Create a new flashcard (front/back), always set isAIGenerated=true. Please check valid categoryId first. Use the get_category tool to find the correct category or set it to null for the default category.',
        schema: z.object({
            front: z.string(),
            back: z.string(),
            category: z.string().optional(),
            difficulty: z.string().optional(),
            tags: z.array(z.string()).optional(),
            source: z.string().optional(),
            isAIGenerated: z.boolean().optional(),
        }),
    }
);

const getFlashcardTool = tool(
    async ({ id }, config: RunnableConfig) => {
        const userId = config?.configurable?.userId as string;
        if (!id || !userId) throw new Error('flashcardId & userId required');
        const fc = await flashcardService.getFlashcardById(id, userId);
        const simple: SimpleFC = { id: fc._id, front: fc.front, back: fc.back };
        return JSON.stringify(simple);
    },
    {
        name: 'get_flashcard',
        description: 'Get detailed information of a flashcard by ID.',
        schema: z.object({
            id: z.string(),
        }),
    }
);

const updateFlashcardTool = tool(
    async (
        { id, front, back, category, difficulty, tags, source, isAIGenerated },
        config: RunnableConfig
    ) => {
        const userId = config?.configurable?.userId as string;
        if (!id || !userId) throw new Error('flashcardId & userId required');
        const data = {
            front,
            back,
            category,
            difficulty: difficulty
                ? normalizeDifficulty(difficulty)
                : undefined,
            tags,
            source,
            isAIGenerated,
        };
        const updated = await flashcardService.updateFlashcard(
            id,
            data as Partial<FlashcardType>,
            userId
        );
        return `Updated: ${JSON.stringify(updated)}`;
    },
    {
        name: 'update_flashcard',
        description: 'Update information of a flashcard.',
        schema: z.object({
            id: z.string(),
            front: z.string().optional(),
            back: z.string().optional(),
            category: z.string().optional(),
            difficulty: z.string().optional(),
            tags: z.array(z.string()).optional(),
            source: z.string().optional(),
            isAIGenerated: z.boolean().optional(),
        }),
    }
);

const deleteFlashcardTool = tool(
    async ({ id }, config: RunnableConfig) => {
        const userId = config?.configurable?.userId as string;
        if (!id || !userId) throw new Error('flashcardId & userId required');
        await flashcardService.deleteFlashcard(id, userId);
        return `Deleted ${id}`;
    },
    {
        name: 'delete_flashcard',
        description: 'Delete a flashcard by ID.',
        schema: z.object({
            id: z.string(),
        }),
    }
);

const searchFlashcardsTool = tool(
    async ({ query, categoryId, page, limit }, config: RunnableConfig) => {
        const userId = config?.configurable?.userId as string;
        if (!userId) throw new Error('userId required');
        const p = page || 1;
        const l = limit || 10;
        let results: unknown = categoryId
            ? await flashcardService.getFlashcardByCategoryId(
                  categoryId,
                  userId,
                  p,
                  l
              )
            : await flashcardService.getAllFlashcard(userId, p, l);
        if (query) {
            const q = query.toLowerCase();
            const extractList = (): SimpleFC[] =>
                Array.isArray(results)
                    ? (results as unknown[]).map((f: unknown) => {
                          const fc = f as Record<string, unknown>;
                          return {
                              id: String(fc.id),
                              front: String(fc.front),
                              back: String(fc.back),
                          };
                      })
                    : results &&
                        typeof results === 'object' &&
                        'flashcards' in (results as Record<string, unknown>)
                      ? (
                            ((results as Record<string, unknown>)
                                .flashcards as unknown[]) || []
                        ).map((f: unknown) => {
                            const fc = f as Record<string, unknown>;
                            return {
                                id: String(fc.id),
                                front: String(fc.front),
                                back: String(fc.back),
                            };
                        })
                      : [];
            const filtered = extractList().filter(
                (f) =>
                    f.front.toLowerCase().includes(q) ||
                    f.back.toLowerCase().includes(q)
            );
            if (Array.isArray(results)) results = filtered;
            else if (results && typeof results === 'object')
                (results as Record<string, unknown>)['flashcards'] = filtered;
        }
        return JSON.stringify(results);
    },
    {
        name: 'search_flashcards',
        description: 'Search flashcards by keyword or category.',
        schema: z.object({
            query: z.string().optional(),
            categoryId: z.string().optional(),
            page: z.number().optional(),
            limit: z.number().optional(),
        }),
    }
);

const bulkCreateFlashcardsTool = tool(
    async ({ flashcards }, config: RunnableConfig) => {
        const userId = config?.configurable?.userId as string;
        if (!userId) throw new Error('userId required');
        if (!Array.isArray(flashcards) || flashcards.length === 0) {
            throw new Error('flashcards array is required and cannot be empty');
        }

        const processedFlashcards = flashcards.map((fc) => ({
            front: fc.front,
            back: fc.back,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            category: fc.category as any,
            difficulty: normalizeDifficulty(fc.difficulty || 'Easy'),
            tags: fc.tags || [],
            source: fc.source || 'AI Generated from Image',
            isAIGenerated: true,
        }));

        const created = await flashcardService.bulkCreateFlashcards(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            processedFlashcards as any[],
            userId
        );

        return `Successfully created ${created.length} flashcards. IDs: ${created
            .map((fc) => fc._id)
            .join(', ')}`;
    },
    {
        name: 'bulk_create_flashcards',
        description:
            'Create multiple flashcards at once. Ideal for processing image content or batch operations. Always set isAIGenerated=true.',
        schema: z.object({
            flashcards: z
                .array(
                    z.object({
                        front: z.string(),
                        back: z.string(),
                        category: z.string().optional(),
                        difficulty: z.string().optional(),
                        tags: z.array(z.string()).optional(),
                        source: z.string().optional(),
                    })
                )
                .min(1),
        }),
    }
);

const bulkUpdateFlashcardsTool = tool(
    async ({ updates }, config: RunnableConfig) => {
        const userId = config?.configurable?.userId as string;
        if (!userId) throw new Error('userId required');
        if (!Array.isArray(updates) || updates.length === 0) {
            throw new Error('updates array is required and cannot be empty');
        }

        const processedUpdates = updates.map((update) => ({
            id: update.id,
            data: {
                ...(update.front && { front: update.front }),
                ...(update.back && { back: update.back }),
                ...(update.category && { category: update.category }),
                ...(update.difficulty && {
                    difficulty: normalizeDifficulty(update.difficulty),
                }),
                ...(update.tags && { tags: update.tags }),
                ...(update.source && { source: update.source }),
                ...(update.isAIGenerated !== undefined && {
                    isAIGenerated: update.isAIGenerated,
                }),
            },
        }));

        const updated = await flashcardService.bulkUpdateFlashcards(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            processedUpdates as any,
            userId
        );

        return `Successfully updated ${updated.length} flashcards`;
    },
    {
        name: 'bulk_update_flashcards',
        description:
            'Update multiple flashcards at once. Useful for auto-arranging or batch modifications.',
        schema: z.object({
            updates: z
                .array(
                    z.object({
                        id: z.string(),
                        front: z.string().optional(),
                        back: z.string().optional(),
                        category: z.string().optional(),
                        difficulty: z.string().optional(),
                        tags: z.array(z.string()).optional(),
                        source: z.string().optional(),
                        isAIGenerated: z.boolean().optional(),
                    })
                )
                .min(1),
        }),
    }
);

export const flashcardTools = [
    createFlashcardTool,
    getFlashcardTool,
    updateFlashcardTool,
    deleteFlashcardTool,
    searchFlashcardsTool,
    bulkCreateFlashcardsTool,
    bulkUpdateFlashcardsTool,
];

export type FlashcardTool = (typeof flashcardTools)[number];
export interface CreateFlashcardToolInput {
    front: string;
    back: string;
    category?: string;
    difficulty: string;
    tags?: string[];
    source?: string;
    isAIGenerated?: boolean;
    userId: string;
}
export interface UpdateFlashcardToolInput
    extends Partial<CreateFlashcardToolInput> {
    id: string;
}
