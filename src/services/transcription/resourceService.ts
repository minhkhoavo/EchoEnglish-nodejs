import { PromptTemplate } from "@langchain/core/prompts";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { googleGenAIClient } from "../../ai/provider/googleGenAIClient";
import { promptManagerService } from "../../ai//service/PromptManagerService";
import { Resource, ResourceTypeModel } from "~/models/resource";
import { ResourceType } from "~/enum/resourceType";

class ResourceService {
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
}

export default new ResourceService();
