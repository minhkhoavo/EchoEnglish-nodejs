import { PromptTemplate } from '@langchain/core/prompts';
import { JsonOutputParser } from '@langchain/core/output_parsers';
import { googleGenAIClient } from '../../ai/provider/googleGenAIClient.js';
import { promptManagerService } from '../../ai//service/PromptManagerService.js';
import { Resource, ResourceTypeModel } from '~/models/resource.js';
import { ResourceType } from '~/enum/resourceType.js';
import { Domain, AVAILABLE_DOMAINS } from '~/enum/domain.js';
import Parser from 'rss-parser';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { YoutubeTranscript } from 'youtube-transcript-plus';
import type { FetchParams, TranscriptSegment } from 'youtube-transcript-plus';
import { PaginationHelper } from '~/utils/pagination.js';
import { FilterQuery, Types } from 'mongoose';
import axios from 'axios';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import pLimit from 'p-limit';
import omit from 'lodash/omit.js';
import s3Service from '../s3Service.js';
import { knowledgeBaseService } from '../knowledgeBase/knowledgeBaseService.js';

interface CreateArticleParams {
    title: string;
    content: string;
    summary?: string;
    thumbnail?: string;
    attachmentUrl?: string;
    attachmentName?: string;
    labels?: {
        cefr?: string;
        domain?: string;
        topic?: string[];
    };
    suitableForLearners?: boolean;
    createdBy: string;
}

interface YoutubeTranscriptSegment {
    text: string;
    offset: number;
    duration: number;
    lang?: string;
}

class ResourceService {
    public async getResourceById(id: string) {
        const resource = await Resource.findById(id);
        if (!resource) {
            return null;
        }
        return omit(resource.toObject(), ['__v']);
    }

    public cleanHtmlContent(html: string): string {
        if (!html) return '';
        let cleaned = html
            .replace(/<a\b[^>]*>(.*?)<\/a>/gi, '$1') // bỏ thẻ a, giữ text
            .trim();
        return cleaned;
    }

    async fetchArticleText(url: string): Promise<string> {
        try {
            const { data } = await axios.get(url, {
                timeout: 10000,
                responseType: 'text',
            });
            const html = typeof data === 'string' ? data : String(data);
            const dom = new JSDOM(html, { url });

            const reader = new Readability(dom.window.document);
            const article = reader.parse();
            return article?.content || '';
        } catch (err) {
            console.error(`[fetchArticleText] Error: ${url}`, err);
            return '';
        }
    }

    public async updateResource(
        id: string,
        updateData: Partial<ResourceTypeModel>
    ) {
        const { title, summary, content, suitableForLearners, labels } =
            updateData;

        const resource = await Resource.findById(id);
        if (!resource) throw new ApiError(ErrorMessage.RESOURCE_NOT_FOUND);

        const update: Partial<ResourceTypeModel> = {};
        if (title !== undefined) update.title = title;
        if (summary !== undefined) update.summary = summary;
        if (content !== undefined) update.content = content;
        if (suitableForLearners !== undefined)
            update.suitableForLearners = suitableForLearners;
        if (labels !== undefined) {
            const current = resource.toObject().labels || {};
            update.labels = { ...current, ...labels };
        }

        const updated = await Resource.findByIdAndUpdate(id, update, {
            new: true,
        });
        return omit(updated?.toObject(), ['__v']);
    }

    public async deleteResource(id: string) {
        const resource = await Resource.findByIdAndDelete(id);
        if (!resource) {
            throw new ApiError(ErrorMessage.RESOURCE_NOT_FOUND);
        }
    }

    private readonly rssFeeds: readonly string[] = [
        'https://e.vnexpress.net/rss/travel.rss',
        'https://e.vnexpress.net/rss/world.rss',
        // 'https://tuoitrenews.vn/rss',
    ];

    // Crawl RSS feed, phân tích bằng LLM rồi lưu vào DB
    public async fetchAndSaveAllRss() {
        const results: ResourceTypeModel[] = [];
        const limit = pLimit(5); // chỉ chạy 5 task song song

        for (const feedUrl of this.rssFeeds) {
            const parser = new Parser();
            const feed = await parser.parseURL(feedUrl);

            let validCount = 0;
            const itemPromises: Promise<ResourceTypeModel | null>[] = [];
            for (const item of feed.items) {
                // Lấy tối đa 3 bài hợp lệ (không trùng) mỗi feed url
                if (validCount >= 1) break;

                const exist = await Resource.findOne({ url: item.link });
                if (exist) {
                    console.log(`[RSS] Skip duplicated: ${item.link}`);
                    continue;
                }

                validCount++;
                itemPromises.push(
                    limit(async () => {
                        const htmlContent = item.link
                            ? await this.fetchArticleText(item.link)
                            : '';

                        const analyzed = await this.analyzeContentWithLLM(
                            item.title + '\n' + htmlContent
                        );

                        // Validate domain - fallback to GENERAL if not in enum
                        if (
                            analyzed.labels?.domain &&
                            !AVAILABLE_DOMAINS.includes(
                                analyzed.labels.domain as Domain
                            )
                        ) {
                            console.warn(
                                `[RSS] Invalid domain "${analyzed.labels.domain}" for ${item.link}, fallback to GENERAL`
                            );
                            analyzed.labels.domain = Domain.GENERAL;
                        } else if (!analyzed.labels?.domain) {
                            analyzed.labels = {
                                ...analyzed.labels,
                                domain: Domain.GENERAL,
                            };
                        }

                        const payload: Partial<ResourceTypeModel> = {
                            type: ResourceType.WEB_RSS,
                            url: item.link || '',
                            title: item.title || 'Untitled',
                            publishedAt: item.pubDate
                                ? new Date(item.pubDate)
                                : new Date(),
                            lang: 'en',
                            summary: analyzed.summary,
                            content: this.cleanHtmlContent(htmlContent),
                            keyPoints: analyzed.keyPoints,
                            labels: analyzed.labels,
                            suitableForLearners: analyzed.suitableForLearners,
                            moderationNotes: analyzed.moderationNotes,
                        };

                        return await this.createResource(payload);
                    })
                );
            }
            const feedResults = await Promise.all(itemPromises);
            results.push(
                ...feedResults.filter((r): r is ResourceTypeModel => r !== null)
            );
        }

        return results;
    }

    public async analyzeContentWithLLM(content: string) {
        //Lấy prompt template
        const templateString =
            await promptManagerService.getTemplate('resource_analysis');

        //Format dữ liệu input
        const formattedPrompt = await PromptTemplate.fromTemplate(
            templateString
        ).format({
            content,
        });

        //Khởi tạo model + parser
        const model = googleGenAIClient.getModel();
        const parser = new JsonOutputParser();

        try {
            //Pipe model qua parser → đảm bảo JSON hợp lệ
            const chain = model.pipe(parser);
            return await chain.invoke(formattedPrompt);
        } catch (error) {
            console.error(
                '[ResourceService] analyzeContentWithLLM failed',
                error
            );
            throw new Error(
                'AI model failed to analyze content or return valid JSON.'
            );
        }
    }

    public async createResource(data: Partial<ResourceTypeModel>) {
        try {
            return await Resource.create(data);
        } catch (err) {
            console.error('[ResourceService] Skipped invalid resource', err);
            return null;
        }
    }

    public extractVideoId = (url: string): string | null => {
        if (!url) return null;

        // Regex này match được nhiều dạng link youtube khác nhau
        const regex =
            /(?:youtube\.com\/(?:.*v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

        const match = url.match(regex);
        return match ? match[1] : null;
    };

    public fetchTranscript = async (
        url: string
    ): Promise<TranscriptSegment[]> => {
        if (!url) throw new ApiError(ErrorMessage.YOUTUBE_URL_REQUIRE);

        const vid = this.extractVideoId(url);
        if (!vid) throw new ApiError(ErrorMessage.INVALID_URL_ID_YOUTUBE);

        const cacheKey = `transcripts/${vid}.json`;
        const cached = await s3Service.getJSON<TranscriptSegment[]>(cacheKey);
        if (cached) return cached;

        const customFetch = async (params: FetchParams): Promise<Response> => {
            const headers: Record<string, string> = {
                ...(params.lang && {
                    'Accept-Language': `${params.lang},en;q=0.9`,
                }),
                'User-Agent':
                    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                Referer: 'https://www.google.com/',
                Origin: 'https://www.youtube.com',
                'Sec-Ch-Ua':
                    '"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"',
                'Sec-Ch-Ua-Mobile': '?1',
                'Sec-Ch-Ua-Platform': '"Android"',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Upgrade-Insecure-Requests': '1',
                ...params.headers,
            };
            return fetch(params.url, {
                method: params.method ?? 'GET',
                headers,
                body: params.body,
                signal: params.signal,
            });
        };

        let transcriptItems: YoutubeTranscriptSegment[];
        try {
            transcriptItems = await YoutubeTranscript.fetchTranscript(vid, {
                lang: 'en',
                videoFetch: customFetch,
                transcriptFetch: customFetch,
                playerFetch: customFetch,
            });
        } catch (err) {
            console.log(
                `[fetchTranscript] Error fetching transcript for ${vid}:`,
                err
            );
            if (
                err instanceof Error &&
                err.constructor.name === 'YoutubeTranscriptTooManyRequestError'
            ) {
                throw new ApiError(ErrorMessage.TRANSCRIPT_RATE_LIMITED);
            }
            console.warn(`[fetchTranscript] No transcript for ${vid}:`, err);
            throw new ApiError(ErrorMessage.TRANSCRIPT_NOT_AVAILABLE);
        }

        // console.log('>>> Raw transcriptItems:', transcriptItems);

        const segments = transcriptItems.map((r: YoutubeTranscriptSegment) => ({
            text: r.text,
            start: r.offset,
            duration: r.duration,
            end: r.duration + r.offset,
        }));
        s3Service.putJSON(cacheKey, segments).catch(() => {});
        return segments;
    };

    public saveTranscriptAsResource = async (url: string) => {
        const vid = this.extractVideoId(url);
        if (!vid) {
            throw new ApiError(ErrorMessage.INVALID_URL_ID_YOUTUBE);
        }

        // Tạo link embed
        const embedUrl = `https://www.youtube.com/embed/${vid}`;

        // Check tồn tại trong DB
        const existing = await Resource.findOne({
            url: embedUrl,
            type: ResourceType.YOUTUBE,
        });
        if (existing) {
            throw new ApiError(ErrorMessage.RESOURCE_ALREADY_EXISTS);
        }

        const transcript = await this.fetchTranscript(url);
        const fullContent = transcript.map((t) => t.text).join(' ');

        // Gọi AI phân tích
        const analyzed = await this.analyzeContentWithLLM(fullContent);

        const payload: Partial<ResourceTypeModel> = {
            type: ResourceType.YOUTUBE,
            url: embedUrl,
            title: analyzed.title || 'Youtube Resource',
            publishedAt: new Date(),
            lang: 'en',
            summary: analyzed.summary,
            content: fullContent,
            keyPoints: analyzed.keyPoints,
            labels: analyzed.labels,
            suitableForLearners: analyzed.suitableForLearners,
            moderationNotes: analyzed.moderationNotes,
        };

        const resource = await this.createResource(payload);
        return omit(resource.toObject(), ['__v']);
    };

    /**
     * Tạo bài viết mới do admin viết
     */
    public createArticle = async (params: CreateArticleParams) => {
        const {
            title,
            content,
            summary,
            thumbnail,
            attachmentUrl,
            attachmentName,
            labels,
            suitableForLearners = true,
            createdBy,
        } = params;

        // Validate domain nếu có
        if (
            labels?.domain &&
            !AVAILABLE_DOMAINS.includes(labels.domain as Domain)
        ) {
            throw new ApiError({
                message: `Invalid domain: ${labels.domain}`,
                status: 400,
            });
        }

        const payload: Partial<ResourceTypeModel> = {
            type: ResourceType.ARTICLE,
            isArticle: true,
            title,
            content,
            summary,
            thumbnail,
            attachmentUrl,
            attachmentName,
            labels: {
                cefr: labels?.cefr,
                domain: labels?.domain as Domain,
                topic: labels?.topic || [],
                speechActs: [],
            },
            publishedAt: new Date(),
            lang: 'en',
            suitableForLearners,
            createdBy: new Types.ObjectId(createdBy),
        };

        const resource = await this.createResource(payload);
        if (!resource) {
            throw new ApiError({
                message: 'Failed to create article',
                status: 500,
            });
        }

        // Index vào knowledge base (RAG)
        try {
            await knowledgeBaseService.indexArticle({
                resourceId: resource._id.toString(),
                title,
                content,
                attachmentUrl,
            });
        } catch {
            // Silent fail - vẫn trả về resource
        }

        return omit(resource.toObject(), ['__v']);
    };

    /**
     * Cập nhật bài viết admin
     */
    public updateArticle = async (
        id: string,
        params: Partial<CreateArticleParams>
    ) => {
        const resource = await Resource.findById(id);
        if (!resource) {
            throw new ApiError(ErrorMessage.RESOURCE_NOT_FOUND);
        }

        if (!resource.isArticle) {
            throw new ApiError({
                message: 'This resource is not an article',
                status: 400,
            });
        }

        const updateData: Partial<ResourceTypeModel> = {};
        if (params.title) updateData.title = params.title;
        if (params.content) updateData.content = params.content;
        if (params.summary) updateData.summary = params.summary;
        if (params.thumbnail) updateData.thumbnail = params.thumbnail;
        if (params.attachmentUrl)
            updateData.attachmentUrl = params.attachmentUrl;
        if (params.attachmentName)
            updateData.attachmentName = params.attachmentName;
        if (params.suitableForLearners !== undefined) {
            updateData.suitableForLearners = params.suitableForLearners;
        }
        if (params.labels) {
            updateData.labels = {
                ...resource.labels,
                ...params.labels,
            };
        }

        const updated = await Resource.findByIdAndUpdate(id, updateData, {
            new: true,
        });

        // Re-index vào knowledge base
        if (params.content || params.attachmentUrl) {
            try {
                await knowledgeBaseService.indexArticle({
                    resourceId: id,
                    title: updated?.title || resource.title,
                    content: updated?.content || resource.content || '',
                    attachmentUrl: updated?.attachmentUrl,
                });
            } catch {
                // Silent fail
            }
        }

        return omit(updated?.toObject(), ['__v']);
    };

    public searchResource = async (
        filters: Record<string, string>,
        page: number,
        limit: number,
        sortOption: Record<string, 1 | -1>
    ) => {
        const query: FilterQuery<ResourceTypeModel> = {};

        if (
            filters.type !== undefined &&
            filters.type !== null &&
            filters.type.trim() !== ''
        ) {
            query.type = filters.type;
        }

        if (
            filters.suitableForLearners !== undefined &&
            filters.suitableForLearners !== null &&
            filters.suitableForLearners.trim() !== ''
        ) {
            if (filters.suitableForLearners === 'true') {
                query.suitableForLearners = true;
            } else {
                query.suitableForLearners = false;
            }
        }

        if (
            filters.q !== undefined &&
            filters.q !== null &&
            filters.q.trim() !== ''
        ) {
            query.title = new RegExp(filters.q, 'i');
        }

        const result = await PaginationHelper.paginate(
            Resource,
            query,
            { page, limit },
            undefined, // populate
            undefined,
            sortOption
        );

        return {
            resources: result.data,
            pagination: result.pagination,
        };
    };
}

interface TranscriptSegment {
    text: string;
    start: number;
    duration: number;
    end: number;
}

export default new ResourceService();
