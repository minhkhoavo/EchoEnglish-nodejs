// Định nghĩa type cho role đã populate
type PopulatedRole = { name: string };
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User, UserType } from '../models/userModel.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';
class AuthService {
    public SECRET_KEY = process.env.JWT_SECRETKEY!;

    public login = async (email: string, password: string) => {
        // Lấy user và populate roles để có name
        const user = await User.findOne({
            email: email,
            isDeleted: false,
        }).populate({ path: 'roles', select: 'name' }); // _id không select vẫn có kèm theo name (trừ khi dùng -_id)
        if (!user) {
            throw new ApiError(ErrorMessage.USER_NOT_FOUND);
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            throw new ApiError(ErrorMessage.UNAUTHORIZED);
        }

        const token = await this.generateToken(user);
        return { token, authenticated: true };
    };

    public generateToken = (user: UserType) => {
        let scopes: string[] = [];
        if (user.roles && user.roles.length) {
            scopes = user.roles.map(
                (role) => (role as unknown as { name: string }).name
            );
        }

        return jwt.sign(
            {
                sub: user.email,
                iss: 'https://echo-english.com',
                scope: scopes.join(' '),
                userId: user._id.toString(),
                custom_key: 'Custom_value',
            },
            this.SECRET_KEY,
            { algorithm: 'HS512', expiresIn: '30d' }
        );
    };
}
export const authService = new AuthService();
