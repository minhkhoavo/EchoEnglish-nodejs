import {
    testAuthoringAIService,
    TestAuthoringAIService,
} from '~/ai/service/testAuthoringAIService.js';

describe('TestAuthoringAIService', () => {
    it('should be defined', () => {
        expect(testAuthoringAIService).toBeDefined();
        expect(testAuthoringAIService).toBeInstanceOf(TestAuthoringAIService);
    });
});
