import { OtpPurpose } from '~/enum/otpPurpose.js';

interface EmailJob {
    id: string;
    email: string;
    otpCode: string;
    purpose: OtpPurpose;
    retries: number;
    createdAt: Date;
}

interface EmailSender {
    sendOtpEmail(
        email: string,
        otpCode: string,
        purpose: OtpPurpose
    ): Promise<void>;
}

/**
 * Simple in-memory email queue (demo only).
 * Production: use Redis BullMQ, RabbitMQ, or Kafka.
 */

// Mỗi 5 giây nó sẽ check queue 1 lần để xử lý tất cả các job có trong queue
// Nếu có lỗi khi gửi mail thì nó tự retry lại sao mỗi 2 giây
export class EmailQueue {
    private queue: EmailJob[] = [];
    private processing = false;
    private maxRetries = 2;
    private emailSender: EmailSender | null = null;

    constructor() {
        // Start processing queue
        this.startProcessing();
    }

    /**
     * Set email sender implementation
     */
    public setEmailSender(sender: EmailSender): void {
        this.emailSender = sender;
    }

    /**
     * Add email job to queue
     */
    public addJob(email: string, otpCode: string, purpose: OtpPurpose): string {
        const jobId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;

        this.queue.push({
            id: jobId,
            email,
            otpCode,
            purpose,
            retries: 0,
            createdAt: new Date(),
        });

        console.log(`[EmailQueue] Added job ${jobId} for ${email}`);

        // Trigger processing if not already running
        if (!this.processing) {
            this.processQueue();
        }

        return jobId;
    }

    /**
     * Start background queue processing
     */
    private startProcessing(): void {
        setInterval(() => {
            if (!this.processing && this.queue.length > 0) {
                this.processQueue();
            }
        }, 5000); // Check every 5 seconds
    }

    /**
     * Process jobs in queue
     */
    private async processQueue(): Promise<void> {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;

        while (this.queue.length > 0) {
            const job = this.queue[0];

            try {
                if (!this.emailSender) {
                    throw new Error('Email sender not configured');
                }

                await this.emailSender.sendOtpEmail(
                    job.email,
                    job.otpCode,
                    job.purpose
                );

                console.log(
                    `[EmailQueue] Successfully sent email for job ${job.id}`
                );

                // Remove job from queue
                this.queue.shift();
            } catch (error) {
                console.error(
                    `[EmailQueue] Error processing job ${job.id}:`,
                    error
                );

                job.retries++;

                if (job.retries >= this.maxRetries) {
                    console.error(
                        `[EmailQueue] Job ${job.id} failed after ${this.maxRetries} retries. Removing from queue.`
                    );
                    this.queue.shift();
                } else {
                    console.log(
                        `[EmailQueue] Job ${job.id} will be retried (attempt ${job.retries}/${this.maxRetries})`
                    );
                    // Move to end of queue for retry
                    this.queue.push(this.queue.shift()!);

                    // Wait before next retry
                    await new Promise((resolve) => setTimeout(resolve, 2000));
                }
            }
        }

        this.processing = false;
    }

    /**
     * Get queue status
     */
    public getStatus(): { queueLength: number; isProcessing: boolean } {
        return {
            queueLength: this.queue.length,
            isProcessing: this.processing,
        };
    }
}

// Singleton instance
export const emailQueue = new EmailQueue();
