import { TransactionType } from './../../enum/transactionType';
import { PaymentStatus } from '~/enum/paymentStatus';
import {Payment} from '../../models/payment'
import { PaymentGateway } from '~/enum/paymentGateway';
import { ErrorMessage } from '~/enum/errorMessage';
import { ApiError } from '~/middleware/apiError';
import {User} from '../../models/userModel'
import { token } from 'morgan';

class PaymentService {
    useToken = async ({userId, tokens, description}: UseTokenInput) =>{
        if (!userId) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }

        if (!tokens || tokens <= 0) {
            throw new ApiError(ErrorMessage.INVALID_TOKEN_AMOUNT);
        }

        const user = await User.findById(userId);
        if (!user) {
            throw new ApiError(ErrorMessage.USER_NOT_FOUND);
        }

        if (user.tokens < tokens) {
            throw new ApiError(ErrorMessage.NOT_ENOUGH_TOKENS);
        }

        // Trừ token
        user.tokens -= tokens;
        await user.save();

        // Lưu transaction
        const transaction = await Payment.create({
            user: user._id,
            type: TransactionType.DEDUCTION,
            tokens,
            description,
            amount: 0,
            status: PaymentStatus.SUCCEEDED,
        });

        return {
            transactionId: transaction._id,
            status: transaction.status,
            tokensDeducted: tokens,
            userTokenBalance: user.token,
        }
    }

    getTransactions = async ({
        userId,
        status,
        type,
        gateway,
        page,
        limit,
    } : TransactionFilter) => {
        const query: any = {};
        if(userId){
            query.user = userId;
        }

        if (status != null) {
            if (Object.values(PaymentStatus).includes(status as PaymentStatus)) {
                query.status = status;
            } else {
                throw new ApiError(ErrorMessage.PAYMENT_STATUS_NOT_FOUND);
            }
        }

        if (type != null) {
            if( Object.values(TransactionType).includes(type as TransactionType)){
                query.type = type;
            }else{
                throw new ApiError(ErrorMessage.TRANSACTION_TYPE_NOT_FOUND);
            }
        }

        if (gateway != null) {
            if(gateway && Object.values(PaymentGateway).includes(gateway as PaymentGateway)){
                query.paymentGateway = gateway;
            } else {
                throw new ApiError(ErrorMessage.PAYMENT_GATEWAY_NOT_FOUND);
            }
        }

        const skip = (page - 1) *limit;
        const [transaction, total] = await Promise.all([
            Payment.find(query)
            .sort({ createAt: -1})
            .skip(skip)
            .limit(limit)
            .lean(),
            Payment.countDocuments(query),
        ])

        return {
            transaction,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        }
    }
}

interface UseTokenInput{
    userId?: string;
    tokens: number;
    description?: string;
}

interface TransactionFilter{
    userId: string;
    status?: string;
    type?: string;
    gateway?: string;
    page: number;
    limit: number;
}

export default PaymentService;