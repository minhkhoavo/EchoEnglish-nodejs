import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User, UserType } from '../models/userModel.js';
import { ApiError } from '~/middleware/apiError.js';
import { ErrorMessage } from '~/enum/errorMessage.js';

class AuthService {
  public SECRET_KEY = process.env.JWT_SECRETKEY!;

  public login = async (email: string, password: string) => {
    const user = await User.findOne({ email: email, isDeleted: false });
    if (!user) {
      throw new ApiError(ErrorMessage.USER_NOT_FOUND);
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      throw new ApiError(ErrorMessage.UNAUTHORIZED);
    }

    const token = this.generateToken(user);
    return { token, authenticated: true };
  };

  public generateToken = (user: UserType) => {
    const scopes: string[] = [];

    if (user.roles && user.roles.length) {
      user.roles.forEach((role) => {
        scopes.push(role.toString());
      });
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
