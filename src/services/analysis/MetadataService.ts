// import { Schema } from 'mongoose';
// import { QuestionMetadata, QuestionMetadataType } from '../../models/questionMetadataModel.js';
// import { PartNumber } from '../../enum/partNumber.js';
// import { SkillCategory } from '../../enum/skillCategory.js';

// /**
//  * MetadataService
//  *
//  * Helper service for querying and aggregating QuestionMetadata.
//  * Used by AnalysisEngineService to match user answers with question skills.
//  */
// export class MetadataService {
//     /**
//      * Get all metadata for a specific test
//      */
//     async getMetadataForTest(testId: Schema.Types.ObjectId | string): Promise<QuestionMetadataType[]> {
//         return await QuestionMetadata.find({ testId }).sort({ questionNumber: 1 });
//     }

//     /**
//      * Get metadata for specific question numbers in a test
//      */
//     async getMetadataForQuestions(
//         testId: Schema.Types.ObjectId | string,
//         questionNumbers: number[]
//     ): Promise<QuestionMetadataType[]> {
//         return await QuestionMetadata.find({
//             testId,
//             questionNumber: { $in: questionNumbers },
//         }).sort({ questionNumber: 1 });
//     }

//     /**
//      * Get metadata by part
//      */
//     async getMetadataByPart(
//         testId: Schema.Types.ObjectId | string,
//         part: PartNumber
//     ): Promise<QuestionMetadataType[]> {
//         return await QuestionMetadata.find({ testId, part }).sort({ questionNumber: 1 });
//     }

//     /**
//      * Get metadata by skill category
//      */
//     async getMetadataBySkillCategory(
//         testId: Schema.Types.ObjectId | string,
//         skillCategory: SkillCategory
//     ): Promise<QuestionMetadataType[]> {
//         return await QuestionMetadata.find({
//             testId,
//             'skillTags.skillCategory': skillCategory,
//         }).sort({ questionNumber: 1 });
//     }

//     /**
//      * Aggregate metadata by part and skill
//      * Returns map: { part -> { skillKey -> questionNumbers[] } }
//      */
//     async aggregateByPartAndSkill(
//         testId: Schema.Types.ObjectId | string
//     ): Promise<Map<PartNumber, Map<string, number[]>>> {
//         const metadata = await this.getMetadataForTest(testId);

//         const result = new Map<PartNumber, Map<string, number[]>>();

//         for (const meta of metadata) {
//             const part = meta.part;
//             const skillKey = this.extractSkillKey(meta);

//             if (!result.has(part)) {
//                 result.set(part, new Map<string, number[]>());
//             }

//             const partMap = result.get(part)!;
//             if (!partMap.has(skillKey)) {
//                 partMap.set(skillKey, []);
//             }

//             partMap.get(skillKey)!.push(meta.questionNumber);
//         }

//         return result;
//     }

//     /**
//      * Aggregate metadata by skill category
//      * Returns map: { skillCategory -> { skillKey -> questionNumbers[] } }
//      */
//     async aggregateBySkillCategory(
//         testId: Schema.Types.ObjectId | string
//     ): Promise<Map<string, Map<string, number[]>>> {
//         const metadata = await this.getMetadataForTest(testId);

//         const result = new Map<string, Map<string, number[]>>();

//         for (const meta of metadata) {
//             const category = meta.skillTags.skillCategory;
//             if (!category) continue; // Skip if no category

//             const skillKey = this.extractSkillKey(meta);

//             if (!result.has(category)) {
//                 result.set(category, new Map<string, number[]>());
//             }

//             const categoryMap = result.get(category)!;
//             if (!categoryMap.has(skillKey)) {
//                 categoryMap.set(skillKey, []);
//             }

//             categoryMap.get(skillKey)!.push(meta.questionNumber);
//         }

//         return result;
//     }

//     /**
//      * Extract skill key from metadata
//      * Uses skillDetail if available, otherwise skillCategory
//      */
//     private extractSkillKey(meta: QuestionMetadataType): string {
//         const tags = meta.skillTags;

//         // For parts with skillDetail
//         if (
//             'skillDetail' in tags &&
//             tags.skillDetail !== undefined &&
//             tags.skillDetail !== null
//         ) {
//             return tags.skillDetail as string;
//         }

//         // Fallback to skillCategory
//         return tags.skillCategory || 'OTHERS';
//     }

//     /**
//      * Get unique skill keys for a test
//      */
//     async getUniqueSkills(testId: Schema.Types.ObjectId | string): Promise<string[]> {
//         const metadata = await this.getMetadataForTest(testId);
//         const skills = new Set<string>();

//         for (const meta of metadata) {
//             skills.add(this.extractSkillKey(meta));
//         }

//         return Array.from(skills);
//     }

//     /**
//      * Get skill category and name for a skill key
//      */
//     async getSkillInfo(
//         testId: Schema.Types.ObjectId | string,
//         skillKey: string
//     ): Promise<{ category: SkillCategory; name: string; parts: PartNumber[] } | null> {
//         const metadata = await QuestionMetadata.findOne({
//             testId,
//             $or: [
//                 { 'skillTags.skillDetail': skillKey },
//                 { 'skillTags.skillCategory': skillKey },
//             ],
//         });

//         if (!metadata) {
//             return null;
//         }

//         // Get all parts that use this skill
//         const allMeta = await QuestionMetadata.find({
//             testId,
//             $or: [
//                 { 'skillTags.skillDetail': skillKey },
//                 { 'skillTags.skillCategory': skillKey },
//             ],
//         });

//         const parts = [...new Set(allMeta.map((m: QuestionMetadataType) => m.part))];

//         return {
//             category: metadata.skillTags.skillCategory,
//             name: this.getSkillDisplayName(skillKey),
//             parts,
//         };
//     }

//     /**
//      * Convert skill key to display name
//      */
//     private getSkillDisplayName(skillKey: string): string {
//         // Convert snake_case to Title Case
//         return skillKey
//             .split('_')
//             .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
//             .join(' ');
//     }

//     /**
//      * Check if test has metadata populated
//      */
//     async hasMetadata(testId: Schema.Types.ObjectId | string): Promise<boolean> {
//         const count = await QuestionMetadata.countDocuments({ testId });
//         return count > 0;
//     }

//     /**
//      * Get metadata coverage percentage
//      */
//     async getMetadataCoverage(
//         testId: Schema.Types.ObjectId | string,
//         totalQuestions: number
//     ): Promise<number> {
//         const count = await QuestionMetadata.countDocuments({ testId });
//         return (count / totalQuestions) * 100;
//     }
// }

// // Export singleton instance
// export const metadataService = new MetadataService();
