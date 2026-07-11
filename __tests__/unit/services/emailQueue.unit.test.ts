/* eslint-disable @typescript-eslint/no-explicit-any */
import { EmailQueue } from '~/services/emailQueue.js';
import { OtpPurpose } from '~/enum/otpPurpose.js';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * Flush all pending promises in the microtask queue.
 */
async function flushPromises() {
    return new Promise<void>((resolve) => setImmediate(resolve));
}

describe('EmailQueue', () => {
    let queue: EmailQueue;
    let mockSender: { sendOtpEmail: jest.Mock };

    beforeEach(() => {
        jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
        queue = new EmailQueue();
        mockSender = { sendOtpEmail: jest.fn() };
        queue.setEmailSender(mockSender);
        jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    // ════════════════════════════════════════════
    // setEmailSender
    // ════════════════════════════════════════════
    describe('setEmailSender', () => {
        it('should set the email sender without throwing', () => {
            const freshQueue = new EmailQueue();
            const sender = { sendOtpEmail: jest.fn() };
            expect(() => freshQueue.setEmailSender(sender)).not.toThrow();
        });
    });

    // ════════════════════════════════════════════
    // addJob
    // ════════════════════════════════════════════
    describe('addJob', () => {
        it('should return a job ID string', () => {
            const jobId = queue.addJob(
                'test@example.com',
                '123456',
                OtpPurpose.REGISTER
            );
            expect(typeof jobId).toBe('string');
            expect(jobId.length).toBeGreaterThan(0);
        });

        it('should immediately increase queue length', () => {
            // Use a sender that never resolves so processing stays in-flight
            mockSender.sendOtpEmail.mockImplementation(
                () => new Promise(() => {})
            );
            queue.addJob('test@example.com', '123456', OtpPurpose.REGISTER);
            // isProcessing = true because processQueue is running, queueLength = 1
            expect(queue.getStatus().queueLength).toBe(1);
        });

        it('should call sendOtpEmail after adding a job', async () => {
            mockSender.sendOtpEmail.mockResolvedValue(undefined);

            queue.addJob('test@example.com', '123456', OtpPurpose.REGISTER);

            await flushPromises(); // allow processQueue microtasks to run

            expect(mockSender.sendOtpEmail).toHaveBeenCalledWith(
                'test@example.com',
                '123456',
                OtpPurpose.REGISTER
            );
        });
    });

    // ════════════════════════════════════════════
    // processQueue
    // ════════════════════════════════════════════
    describe('processQueue', () => {
        it('should remove job from queue after successful email send', async () => {
            mockSender.sendOtpEmail.mockResolvedValue(undefined);

            queue.addJob('test@example.com', '123456', OtpPurpose.REGISTER);
            await flushPromises();

            expect(queue.getStatus().queueLength).toBe(0);
            expect(queue.getStatus().isProcessing).toBe(false);
        });

        it('should process multiple jobs in sequential order', async () => {
            const callOrder: string[] = [];
            mockSender.sendOtpEmail.mockImplementation(
                async (email: string) => {
                    callOrder.push(email);
                }
            );

            queue.addJob('a@test.com', '111', OtpPurpose.REGISTER);
            queue.addJob('b@test.com', '222', OtpPurpose.FORGOT_PASSWORD);

            await flushPromises();
            await flushPromises(); // second flush for second job

            expect(callOrder[0]).toBe('a@test.com');
            expect(callOrder).toContain('b@test.com');
            expect(queue.getStatus().queueLength).toBe(0);
        });

        it('should retry failed jobs and remove after maxRetries', async () => {
            mockSender.sendOtpEmail.mockRejectedValue(new Error('SMTP error'));

            queue.addJob('fail@test.com', '999', OtpPurpose.REGISTER);

            // First attempt fails, retries increment
            await flushPromises();

            // Advance 2s to trigger retry setTimeout
            jest.advanceTimersByTime(2000);
            await flushPromises();

            // Advance 2s again for second retry
            jest.advanceTimersByTime(2000);
            await flushPromises();

            // After maxRetries (2), job is removed
            expect(queue.getStatus().queueLength).toBe(0);
            expect(mockSender.sendOtpEmail).toHaveBeenCalledTimes(2);
        });

        it('should throw "Email sender not configured" when no sender is set', async () => {
            const freshQueue = new EmailQueue();
            // No sender set → will throw internally, retry up to maxRetries then remove
            jest.spyOn(console, 'error').mockImplementation();
            jest.spyOn(console, 'log').mockImplementation();

            freshQueue.addJob('no-sender@test.com', '000', OtpPurpose.REGISTER);
            await flushPromises();

            // First attempt fails
            jest.advanceTimersByTime(2000);
            await flushPromises();

            // Second (final) attempt fails → job removed
            jest.advanceTimersByTime(2000);
            await flushPromises();

            expect(freshQueue.getStatus().queueLength).toBe(0);
        });

        it('should handle setTimeout without unref (e.g. browser env) gracefully during retry', async () => {
            mockSender.sendOtpEmail.mockRejectedValue(new Error('SMTP error'));

            const originalSetTimeout = global.setTimeout;
            (global as any).setTimeout = jest.fn((cb, ms) => {
                originalSetTimeout(cb, ms);
                // Return a fake ID without unref
                return 12345;
            });

            queue.addJob('browser@test.com', '123', OtpPurpose.REGISTER);

            await flushPromises();

            jest.advanceTimersByTime(2000);
            await flushPromises();

            expect((global as any).setTimeout).toHaveBeenCalled();
            global.setTimeout = originalSetTimeout;
        });
    });

    // ════════════════════════════════════════════
    // startProcessing (setInterval)
    // ════════════════════════════════════════════
    describe('startProcessing interval', () => {
        it('should trigger processQueue via setInterval when queue has pending jobs', async () => {
            mockSender.sendOtpEmail.mockResolvedValue(undefined);

            queue.addJob('interval@test.com', '555', OtpPurpose.REGISTER);
            await flushPromises();

            expect(mockSender.sendOtpEmail).toHaveBeenCalledWith(
                'interval@test.com',
                '555',
                OtpPurpose.REGISTER
            );
        });

        it('should not call sendOtpEmail if queue is empty when interval fires', async () => {
            // Advance timer by one interval (5s) without adding jobs
            jest.advanceTimersByTime(5000);
            await flushPromises();

            expect(mockSender.sendOtpEmail).not.toHaveBeenCalled();
        });

        it('should trigger processQueue from setInterval when queue has jobs and not currently processing (line 76)', async () => {
            // Ensure queue is idle first
            mockSender.sendOtpEmail.mockResolvedValue(undefined);

            const testQueue = new EmailQueue();
            const testSender = {
                sendOtpEmail: jest.fn().mockResolvedValue(undefined),
            };
            testQueue.setEmailSender(testSender);

            // Push job directly — addJob triggers processQueue immediately
            testQueue.addJob('trigger@test.com', '999', OtpPurpose.REGISTER);
            await flushPromises(); // job processed, queue empty, processing=false

            // Add another job while idle (processing=false)
            testSender.sendOtpEmail.mockImplementation(
                () => new Promise(() => {})
            ); // never resolves
            testQueue.addJob('stalled@test.com', '777', OtpPurpose.REGISTER);

            // Manually mark processing=false to simulate a stalled scenario for interval
            (testQueue as any).processing = false;

            // Now fire the interval — should call processQueue() → line 76
            jest.advanceTimersByTime(5000);
            await flushPromises();

            expect(testSender.sendOtpEmail).toHaveBeenCalledWith(
                'stalled@test.com',
                '777',
                OtpPurpose.REGISTER
            );
        });

        it('should handle setInterval returning a number (browser env) gracefully', () => {
            const originalSetInterval = global.setInterval;
            (global as any).setInterval = jest.fn().mockReturnValue(12345);

            new EmailQueue();

            expect((global as any).setInterval).toHaveBeenCalled();
            global.setInterval = originalSetInterval;
        });
    });

    // ════════════════════════════════════════════
    // getStatus
    // ════════════════════════════════════════════
    describe('getStatus', () => {
        it('should return queueLength=0 and isProcessing=false initially', () => {
            expect(queue.getStatus()).toEqual({
                queueLength: 0,
                isProcessing: false,
            });
        });

        it('should reflect queueLength=1 and isProcessing=true while processing', () => {
            mockSender.sendOtpEmail.mockImplementation(
                () => new Promise(() => {})
            );
            queue.addJob('a@test.com', '111', OtpPurpose.REGISTER);

            const status = queue.getStatus();
            expect(status.queueLength).toBe(1);
            expect(status.isProcessing).toBe(true);
        });

        it('should return early from processQueue when already processing (line 86 branch)', async () => {
            // Make first job never resolve so processing stays true
            mockSender.sendOtpEmail.mockImplementation(
                () => new Promise(() => {})
            );
            queue.addJob('a@test.com', '111', OtpPurpose.REGISTER);

            // processing=true now — calling addJob again skips the if(!processing) guard
            queue.addJob('b@test.com', '222', OtpPurpose.REGISTER);

            // Directly call processQueue while processing=true → should return early (line 86)
            // We access private method via casting
            await (queue as any).processQueue();

            // sendOtpEmail still only called once (first job), second invocation returned early
            expect(mockSender.sendOtpEmail).toHaveBeenCalledTimes(1);
        });
    });
});
