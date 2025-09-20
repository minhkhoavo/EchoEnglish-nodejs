import { PromptTemplate } from "@langchain/core/prompts";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { googleGenAIClient } from "../../ai/provider/googleGenAIClient";
import { promptManagerService } from "../../ai//service/PromptManagerService";
import { Resource, ResourceTypeModel } from "~/models/resource";
import { ResourceType } from "~/enum/resourceType";
import Parser from "rss-parser";
import { ApiError } from "~/middleware/apiError";
import { ErrorMessage } from "~/enum/errorMessage";
import { YoutubeTranscript } from "youtube-transcript";


class ResourceService {
    public async updateResource(id: string, updateData: Partial<ResourceTypeModel>) {
        const { title, summary, approved, lang } = updateData;
        const resource = await Resource.findByIdAndUpdate(id, { title, summary, approved, lang }, { new: true });
        if (!resource) throw new ApiError(ErrorMessage.RESOURCE_NOT_FOUND);
        return resource;
    }

    public async deleteResource(id: string) {
        return await Resource.findByIdAndDelete(id);
    }

    // Crawl RSS feed, phân tích bằng LLM rồi lưu vào DB
    public async fetchAndSaveRss(feedUrl: string) {
        const parser = new Parser();
        const feed = await parser.parseURL(feedUrl);

        const results: ResourceTypeModel[] = [];
            for (const item of feed.items) {
            const fullContent = `${item.title}\n${item.contentSnippet || ""}`;
            const analyzed = await this.analyzeContentWithLLM(fullContent);

            const saved = await this.createResource({
                type: ResourceType.WEB_RSS,
                url: item.link || "",
                title: item.title || "Untitled",
                publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
                lang: "en",
                summary: analyzed.summary,
                content: fullContent,
                keyPoints: analyzed.keyPoints,
                labels: analyzed.labels,
                suitableForLearners: analyzed.suitableForLearners,
                moderationNotes: analyzed.moderationNotes,
            });
            results.push(saved);
            console.log('-------saved items rss-------------------');
            console.log(saved);
        }
        return results;
    }

    public async analyzeContentWithLLM(content: string) {
        //Lấy prompt template
        const templateString = await promptManagerService.getTemplate("resource_analysis");

        //Format dữ liệu input
        const formattedPrompt = await PromptTemplate.fromTemplate(templateString).format({
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
            console.error("[ResourceService] analyzeContentWithLLM failed", error);
            throw new Error("AI model failed to analyze content or return valid JSON.");
        }
    }

    public async createResource(data: Partial<ResourceTypeModel>) {
        return await Resource.create(data);
    }

    public extractVideoId = (url: string): string | null => {
            if (!url) return null;
    
            // Regex này match được nhiều dạng link youtube khác nhau
            const regex =
                /(?:youtube\.com\/(?:.*v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    
            const match = url.match(regex);
            return match ? match[1] : null;
        };
    
    public fetchTranscript = async (url: string):Promise<TranscriptSegment[]> => {
        if (!url)
            throw new ApiError(ErrorMessage.YOUTUBE_URL_REQUIRE);

        const vid = this.extractVideoId(url);
        if(!vid)
            throw new ApiError(ErrorMessage.INVALID_URL_ID_YOUTUBE);

            console.log(">>> Extracted videoId:", vid);

        const transcriptItems = await YoutubeTranscript.fetchTranscript(vid,{ lang: 'en' });

        console.log(">>> Raw transcriptItems:", transcriptItems);

        return transcriptItems.map(r => ({
            text: r.text,
            start: r.offset,
            duration: r.duration,
            end: r.duration +r.offset
        }));
    }

    public saveTranscriptAsResource = async (url: string) => {
        const transcript = await this.fetchTranscript(url);
        const fullContent = transcript.map(t => t.text).join(" ");

        // Gọi AI phân tích
        const analyzed = await this.analyzeContentWithLLM(fullContent);

        return await this.createResource({
            type: ResourceType.YOUTUBE,
            url,
            title: analyzed.title || "Youtube Resource",
            publishedAt: new Date(),
            lang: "en",
            summary: analyzed.summary,
            content: fullContent,
            keyPoints: analyzed.keyPoints,
            labels: analyzed.labels,
            suitableForLearners: analyzed.suitableForLearners,
            moderationNotes: analyzed.moderationNotes,
        });
    };
}


interface TranscriptSegment {
  text: string;
  start: number;    
  duration: number;  
  end: number;      
}

export default new ResourceService();
