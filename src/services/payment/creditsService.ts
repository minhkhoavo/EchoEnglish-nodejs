import { ErrorMessage } from '~/enum/errorMessage.js';
import { ApiError } from '~/middleware/apiError.js';
import { User, UserType } from '~/models/userModel.js';
import { Payment } from '~/models/payment.js';
import { TransactionType } from '~/enum/transactionType.js';
import { PaymentStatus } from '~/enum/paymentStatus.js';
import {
    FeaturePricingType,
    FEATURE_PRICING_MAP,
    FEATURE_DESCRIPTION_MAP,
} from '~/enum/featurePricing.js';
import notificationService from '~/services/notifications/notificationService.js';
import { NotificationType } from '~/enum/notificationType.js';

class CreditsService {
    public getFeaturePrice(featureType: string): number {
        const price = FEATURE_PRICING_MAP[featureType as FeaturePricingType];
        if (price === undefined) {
            console.warn(`Feature pricing not found for: ${featureType}`);
            return 0;
        }
        return price;
    }

    public getFeaturePricing(): Record<FeaturePricingType, number> {
        return { ...FEATURE_PRICING_MAP };
    }

    public async deductCreditsForFeature(
        userId: string,
        featureType: string,
        description?: string
    ): Promise<{
        success: boolean;
        creditsDeducted: number;
        remainingCredits: number;
        transactionId: string;
    }> {
        if (!userId) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }

        const credits = this.getFeaturePrice(featureType);

        if (credits === 0) {
            const user = await User.findById(userId).lean<UserType>().exec();
            if (!user) {
                throw new ApiError(ErrorMessage.USER_NOT_FOUND);
            }
            return {
                success: true,
                creditsDeducted: 0,
                remainingCredits: user.credits || 0,
                transactionId: '',
            };
        }

        const finalDescription =
            description || this.generateDescription(featureType);

        return this.deductCredits(
            userId,
            credits,
            finalDescription,
            featureType
        );
    }

    private generateDescription(featureType: string): string {
        const description =
            FEATURE_DESCRIPTION_MAP[featureType as FeaturePricingType];
        return description || `Feature: ${featureType}`;
    }

    public async deductCredits(
        userId: string,
        credits: number,
        description: string,
        featureType: string
    ): Promise<{
        success: boolean;
        creditsDeducted: number;
        remainingCredits: number;
        transactionId: string;
    }> {
        if (!userId) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }

        if (!credits || credits <= 0) {
            throw new ApiError(ErrorMessage.INVALID_TOKEN_AMOUNT);
        }

        const user = await User.findById(userId).lean<UserType>().exec();
        if (!user) {
            throw new ApiError(ErrorMessage.USER_NOT_FOUND);
        }

        if (user.credits < credits) {
            throw new ApiError(ErrorMessage.NOT_ENOUGH_TOKENS);
        }

        const userUpdated = await User.findByIdAndUpdate(
            { _id: user._id },
            { $inc: { credits: -credits } },
            { new: true }
        )
            .lean<UserType>()
            .exec();

        const transaction = await Payment.create({
            user: user._id,
            type: TransactionType.DEDUCTION,
            tokens: credits,
            description: `${description} (${featureType})`,
            amount: 0,
            status: PaymentStatus.SUCCEEDED,
        });

        // Send notification to user
        await notificationService.pushNotification(user._id.toString(), {
            title: 'Credits Deducted',
            body: `${credits} credits have been deducted for ${description}. Remaining credits: ${userUpdated?.credits || 0}`,
            type: NotificationType.PAYMENT,
            userIds: [user._id],
        });

        return {
            success: true,
            creditsDeducted: credits,
            remainingCredits: userUpdated?.credits || 0,
            transactionId: transaction._id.toString(),
        };
    }

    public async hasEnoughCredits(
        userId: string,
        requiredCredits: number
    ): Promise<boolean> {
        if (!userId) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }

        const user = await User.findById(userId).lean<UserType>().exec();
        if (!user) {
            throw new ApiError(ErrorMessage.USER_NOT_FOUND);
        }

        return user.credits >= requiredCredits;
    }

    public async getCurrentCredits(userId: string): Promise<number> {
        if (!userId) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }

        const user = await User.findById(userId)
            .select('credits')
            .lean<UserType>()
            .exec();
        if (!user) {
            throw new ApiError(ErrorMessage.USER_NOT_FOUND);
        }

        return user.credits || 0;
    }

    public async checkCanAffordFeature(
        userId: string,
        featureType: string
    ): Promise<{
        canAfford: boolean;
        requiredCredits: number;
        currentCredits: number;
        featureType: string;
    }> {
        if (!userId) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }

        const user = await User.findById(userId)
            .select('credits')
            .lean<UserType>()
            .exec();
        if (!user) {
            throw new ApiError(ErrorMessage.USER_NOT_FOUND);
        }

        const requiredCredits = this.getFeaturePrice(featureType);
        const currentCredits = user.credits || 0;
        const canAfford = currentCredits >= requiredCredits;

        return {
            canAfford,
            requiredCredits,
            currentCredits,
            featureType,
        };
    }
}

export default new CreditsService();
