import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User, UserType } from '../models/userModel.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
class AuthService {
    public SECRET_KEY = process.env.JWT_SECRETKEY!;

    public login = async (
        email: string,
        password: string
    ): Promise<{ token: string; authenticated: boolean }> => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email || !emailRegex.test(email)) {
            throw new ApiError(ErrorMessage.EMAIL_INVALID);
        }
        if (!password || password.length < 8) {
            throw new ApiError(ErrorMessage.PASSWORD_MUST_BE_8_CHARACTERS);
        }

        // Find by email
        const user = await User.findOne({ email: email });

        if (!user) {
            throw new ApiError(ErrorMessage.USER_NOT_FOUND);
        } else {
            if (user.isDeleted === true) {
                throw new ApiError(ErrorMessage.USER_HAS_BEEN_DELETED);
            } else {
                const match = await bcrypt.compare(password, user.password);
                if (match === false) {
                    throw new ApiError(ErrorMessage.PASSWORD_INCORECT);
                } else {
                    const token = await this.generateToken(user);
                    return { token, authenticated: true };
                }
            }
        }
    };

    public generateToken = (user: UserType): string => {
        const scope = user.role || '';

        return jwt.sign(
            {
                sub: user.email,
                iss: 'https://toeic.mkhoavo.site',
                scope: scope,
                userId: user._id.toString(),
                custom_key: 'Custom_value',
            },
            this.SECRET_KEY,
            { algorithm: 'HS512', expiresIn: '30d' }
        );
    };
}
export const authService = new AuthService();
