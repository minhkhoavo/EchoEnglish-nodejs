// ragRetrieveTool.ts
import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import type { RunnableConfig } from '@langchain/core/runnables';
import { chromaVectorService } from '~/services/document-analyze/chromaService.js';

export const retrieveMyFilesTool = tool(
    async (
        {
            query,
            fileIds,
            topK,
        }: { query: string; fileIds?: string[]; topK?: number },
        config: RunnableConfig
    ) => {
        const userId = config?.configurable?.userId as string;
        if (!userId) throw new Error('userId required');

        const search = await chromaVectorService.query({
            userId,
            question: query,
            fileIds,
            topK: topK ?? 4,
        });

        return {
            chunks: search.documents.map((doc, i) => ({
                text: doc,
                meta: search.metadatas[i],
                distance: search.distances[i] ?? 0,
            })),
        };
    },
    {
        name: 'retrieve_my_files',
        description:
            "Retrieve top relevant chunks from the user's uploaded files. Use as context to answer questions about their documents. If filesIds is empty will search full user files.",
        schema: z.object({
            query: z.string().min(3),
            fileIds: z.array(z.string()).optional(),
            topK: z.number().int().min(1).max(10).optional(),
        }),
    }
);
