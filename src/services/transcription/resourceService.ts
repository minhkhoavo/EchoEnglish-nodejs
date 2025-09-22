import { PromptTemplate } from '@langchain/core/prompts';
import { JsonOutputParser } from '@langchain/core/output_parsers';
import { googleGenAIClient } from '../../ai/provider/googleGenAIClient.js';
import { promptManagerService } from '../../ai//service/PromptManagerService.js';
import { Resource, ResourceTypeModel } from '~/models/resource.js';
import { ResourceType } from '~/enum/resourceType.js';
import Parser from 'rss-parser';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { YoutubeTranscript } from 'youtube-transcript';
import { PaginationHelper } from '~/utils/pagination.js';
import { FilterQuery } from 'mongoose';
import axios from 'axios';
import * as cheerio from 'cheerio';
import pLimit from 'p-limit';

class ResourceService {
    async fetchArticleText(url: string): Promise<string> {
        try {
            const { data } = await axios.get(url, { timeout: 10000 });
            const $ = cheerio.load(data as string);

            // Ưu tiên lấy text trong <article>
            const articleText = $('article').text().replace(/\s+/g, ' ').trim();

            // Nếu không có <article> thì lấy body text
            const bodyText = $('body').text().replace(/\s+/g, ' ').trim();

            return articleText || bodyText;
        } catch (err) {
            console.error(`[fetchArticleText] Error: ${url}`, err);
            return '';
        }
    }

    // async fetchArticleHtml(url: string): Promise<string> {
    //      try {
    //           const { data } = await axios.get(url, { timeout: 10000 });
    //           return data;
    //      } catch (err) {
    //           console.error(`[fetchArticleHtml] Error: ${url}`, err);
    //           return "";
    //      }
    // }

    public async updateResource(
        id: string,
        updateData: Partial<ResourceTypeModel>
    ) {
        const { title, summary, approved, lang } = updateData;
        const resource = await Resource.findByIdAndUpdate(
            id,
            { title, summary, approved, lang },
            { new: true }
        );
        if (!resource) throw new ApiError(ErrorMessage.RESOURCE_NOT_FOUND);
        return resource;
    }

    public async deleteResource(id: string) {
        return await Resource.findByIdAndDelete(id);
    }

    private readonly rssFeeds: readonly string[] = [
        'https://vnexpress.net/rss/so-hoa.rss',
        // "https://www.nytimes.com/rss",
        // "https://www.theguardian.com/uk/rss",
    ];

    // Crawl RSS feed, phân tích bằng LLM rồi lưu vào DB
    public async fetchAndSaveAllRss() {
        const results: ResourceTypeModel[] = [];
        const limit = pLimit(5); // chỉ chạy 5 task song song

        for (const feedUrl of this.rssFeeds) {
            const parser = new Parser();
            const feed = await parser.parseURL(feedUrl);

            const itemPromises = feed.items.map((item) =>
                limit(async () => {
                    const exist = await Resource.findOne({ url: item.link });
                    if (exist) {
                        console.log(`[RSS] Skip duplicated: ${item.link}`);
                        return null;
                    }

                    const htmlContent = item.link
                        ? await this.fetchArticleText(item.link)
                        : '';
                    const fullContent = `${item.title}\n${item.contentSnippet || ''}\n${htmlContent}`;

                    const analyzed =
                        await this.analyzeContentWithLLM(fullContent);

                    return await this.createResource({
                        type: ResourceType.WEB_RSS,
                        url: item.link || '',
                        title: item.title || 'Untitled',
                        publishedAt: item.pubDate
                            ? new Date(item.pubDate)
                            : new Date(),
                        lang: 'en',
                        summary: analyzed.summary,
                        content: fullContent,
                        keyPoints: analyzed.keyPoints,
                        labels: analyzed.labels,
                        suitableForLearners: analyzed.suitableForLearners,
                        moderationNotes: analyzed.moderationNotes,
                    });
                })
            );

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

        console.log('>>> Extracted videoId:', vid);

        const transcriptItems = await YoutubeTranscript.fetchTranscript(vid, {
            lang: 'en',
        });

        console.log('>>> Raw transcriptItems:', transcriptItems);

        return transcriptItems.map((r) => ({
            text: r.text,
            start: r.offset,
            duration: r.duration,
            end: r.duration + r.offset,
        }));
    };

    public saveTranscriptAsResource = async (url: string) => {
        // Check tồn tại trong DB
        const existing = await Resource.findOne({
            url,
            type: ResourceType.YOUTUBE,
        });
        if (existing) {
            throw new ApiError(ErrorMessage.RESOURCE_ALREADY_EXISTS);
        }

        const transcript = await this.fetchTranscript(url);
        const fullContent = transcript.map((t) => t.text).join(' ');

        // Gọi AI phân tích
        const analyzed = await this.analyzeContentWithLLM(fullContent);

        return await this.createResource({
            type: ResourceType.YOUTUBE,
            url,
            title: analyzed.title || 'Youtube Resource',
            publishedAt: new Date(),
            lang: 'en',
            summary: analyzed.summary,
            content: fullContent,
            keyPoints: analyzed.keyPoints,
            labels: analyzed.labels,
            suitableForLearners: analyzed.suitableForLearners,
            moderationNotes: analyzed.moderationNotes,
        });
    };

    public searchResource = async (
        isAdmin: boolean,
        filters: Record<string, string>,
        page: number,
        limit: number,
        sortOption: Record<string, 1 | -1>
    ) => {
        try {
            const query: FilterQuery<ResourceTypeModel> = {};

            if (!isAdmin) {
                query.suitableForLearners =
                    filters.suitableForLearners !== undefined
                        ? filters.suitableForLearners
                        : true;
                query.approved =
                    filters.approved !== undefined ? filters.approved : true;
            }

            if (filters.type) query.type = filters.type;
            if (filters.style) query['labels.style'] = filters.style;
            if (filters.domain) query['labels.domain'] = filters.domain;
            if (filters.topic) query['labels.topic'] = { $in: [filters.topic] };
            if (filters.genre) query['labels.genre'] = filters.genre;

            if (filters.q) {
                const searchRegex = new RegExp(filters.q, 'i');
                query.$or = [
                    { title: searchRegex },
                    { summary: searchRegex },
                    { content: searchRegex },
                    { keyPoints: { $in: [searchRegex] } },
                ];
            }

            const result = await PaginationHelper.paginate(
                Resource,
                query,
                { page, limit },
                undefined,
                '-labels',
                sortOption
            );

            return {
                resource: result.data,
                pagination: result.pagination,
            };
        } catch (err: unknown) {
            if (err instanceof ApiError) throw err;
            if (err instanceof Error) {
                throw new ApiError({ message: err.message });
            }
            throw new ApiError({ message: 'Unknown error occurred' });
        }
    };
}

interface TranscriptSegment {
    text: string;
    start: number;
    duration: number;
    end: number;
}

export default new ResourceService();
