import {
    UserResponse,
    UserProfileResponse,
    UserCreateRequest,
    UserUpdateRequest,
} from '~/types/user.types.js';
import omit from 'lodash/omit.js';
import { User, UserType } from '../models/userModel.js';
import bcrypt from 'bcrypt';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { OtpEmailService } from './otpEmailService.js';
import { OtpPurpose } from '~/enum/otpPurpose.js';
import { Role, RoleType } from '~/models/roleModel.js';
import { RoleName } from '~/enum/role.js';
import { ApiError } from '~/middleware/apiError.js';
import CategoryFlashcardService from './categoryFlashcardService.js';

const otpEmailService = new OtpEmailService();
const categoryService = new CategoryFlashcardService();

class UserService {
    public getUserById = async (id: string): Promise<UserResponse> => {
        const user = await User.findOne({ _id: id, isDeleted: false }).select(
            '-password -isDeleted -__v'
        );
        if (!user) throw new ApiError(ErrorMessage.USER_NOT_FOUND);
        return user;
    };

    public getProfile = async (email: string): Promise<UserProfileResponse> => {
        const user = await User.findOne({ email }).select(
            '-password -isDeleted -roles -__v'
        );
        if (!user) throw new ApiError(ErrorMessage.USER_NOT_FOUND);

        return user;
    };

    public registerUser = async (
        userDto: UserCreateRequest
    ): Promise<UserResponse> => {
        const existUser = await User.findOne({ email: userDto.email });
        const hashPassword = await this.hashPassword(userDto.password);

        if (existUser) {
            if (existUser.isDeleted === false) {
                throw new ApiError(ErrorMessage.USER_EXISTED);
            }
            await otpEmailService.sendOtp(existUser.email, OtpPurpose.REGISTER);
            const populatedUser = await User.populate(existUser, {
                path: 'roles',
                populate: { path: 'permissions' },
            });
            const userResponse = populatedUser.toObject();
            return omit(userResponse, [
                'password',
                'isDeleted',
                '__v',
            ]) as UserResponse;
        }

        const userRole = await Role.findOne({ name: RoleName.USER })
            .populate('permissions')
            .exec();
        if (!userRole) {
            throw new ApiError(ErrorMessage.ROLE_NOT_FOUND);
        }

        const user = new User({
            fullName: userDto.fullName,
            email: userDto.email,
            password: hashPassword,
            gender: userDto.gender,
            dob: userDto.dob,
            phoneNumber: userDto.phoneNumber,
            address: userDto.address,
            image: userDto.image,
            isDeleted: true,
            roles: [userRole._id],
        });
        const savedUser = await user.save();
        await otpEmailService.sendOtp(savedUser.email, OtpPurpose.REGISTER);
        const populatedUser = await User.populate(savedUser, {
            path: 'roles',
            populate: { path: 'permissions' },
        });
        return omit(populatedUser.toObject(), [
            'password',
            'isDeleted',
            '__v',
        ]) as UserResponse;
    };

    public createUser = async (
        userDto: UserCreateRequest
    ): Promise<UserResponse> => {
        const hashPassword = await this.hashPassword(userDto.password);
        const existUser = await User.findOne({ email: userDto.email });
        if (existUser) {
            if (existUser.isDeleted === false) {
                throw new ApiError(ErrorMessage.USER_EXISTED);
            }
            existUser.isDeleted = false;
            existUser.password = hashPassword;
            const savedUser = await existUser.save();

            return omit(savedUser.toObject(), [
                'password',
                'isDeleted',
                '__v',
            ]) as UserResponse;
        }

        const userRole = await Role.findOne({ name: RoleName.USER })
            .populate('permissions')
            .exec();
        if (!userRole) {
            throw new ApiError(ErrorMessage.ROLE_NOT_FOUND);
        }
        const user = new User({
            fullName: userDto.fullName,
            email: userDto.email,
            password: hashPassword,
            gender: userDto.gender,
            dob: userDto.dob,
            phoneNumber: userDto.phoneNumber,
            address: userDto.address,
            image: userDto.image,
            isDeleted: false,
            roles: [userRole._id],
        });
        const savedUser = await user.save();

        // Tạo category mặc định cho user

        await categoryService.createCategory(
            {
                name: 'Uncategorized',
                description: 'Default category for uncategorized flashcards',
                is_default: true,
            },
            savedUser._id.toString()
        );
        return omit(savedUser.toObject(), [
            'password',
            'isDeleted',
            '__v',
        ]) as UserResponse;
    };

    public hashPassword = async (password: string): Promise<string> => {
        const saltRounds = 10;
        const salt = bcrypt.genSaltSync(saltRounds);
        return bcrypt.hashSync(password, salt);
    };

    public resetPasswordWithOtp = async (
        email: string,
        newPassword: string,
        otp: string
    ): Promise<void> => {
        await otpEmailService.verifyOtp(email, otp, OtpPurpose.FORGOT_PASSWORD);
        const user = await User.findOne({ email: email, isDeleted: false });
        if (!user) {
            throw new ApiError(ErrorMessage.USER_NOT_FOUND);
        }
        const hashPassword = await this.hashPassword(newPassword);
        user.password = hashPassword;
        await user.save();
    };

    public updateUser = async (
        userId: string,
        request: UserUpdateRequest
    ): Promise<UserResponse> => {
        const user = await User.findOneAndUpdate(
            { _id: userId, isDeleted: false },
            request,
            { new: true, runValidators: true }
        ).select('-password -isDeleted -__v');
        if (!user) {
            throw new ApiError(ErrorMessage.USER_NOT_FOUND);
        }
        return user;
    };

    public updateProfileUser = async (
        userId: string,
        request: Partial<UserType>
    ): Promise<UserProfileResponse> => {
        const user = await User.findOneAndUpdate(
            { _id: userId, isDeleted: false },
            request,
            { new: true, runValidators: true }
        ).select('-password -isDeleted -roles -__v');
        if (!user) {
            throw new ApiError(ErrorMessage.USER_NOT_FOUND);
        }
        return user;
    };

    public softDelete = async (userId: string): Promise<void> => {
        const user = await User.findById(userId);
        if (!user || user.isDeleted) {
            throw new ApiError(ErrorMessage.USER_NOT_FOUND);
        }
        user.isDeleted = true;
        await user.save();
    };

    public isAdmin = async (userScope: string): Promise<boolean> => {
        const roles = await Role.find({ _id: userScope });
        const isAdmin = roles.some((role: RoleType) => role.name === 'ADMIN');
        return isAdmin;
    };
}

export default UserService;
