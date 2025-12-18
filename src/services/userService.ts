import {
    UserResponse,
    UserProfileResponse,
    UserCreateRequest,
    UserUpdateRequest,
    UserPreferences,
    SetUserPreferencesRequest,
} from '~/types/user.types.js';
import omit from 'lodash/omit.js';
import { User, UserType } from '../models/userModel.js';
import bcrypt from 'bcrypt';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { OtpEmailService } from './otpEmailService.js';
import { OtpPurpose } from '~/enum/otpPurpose.js';
import { Role } from '~/enum/role.js';
import { DeletedReason } from '~/enum/deletedReason.js';
import { ApiError } from '~/middleware/apiError.js';
import CategoryFlashcardService from './categoryFlashcardService.js';
import { PaginationHelper } from '~/utils/pagination.js';

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
            '-password -isDeleted -__v'
        );
        if (!user) throw new ApiError(ErrorMessage.USER_NOT_FOUND);

        return user;
    };

    public registerUser = async (
        userDto: UserCreateRequest
    ): Promise<UserResponse> => {
        if (
            userDto.email == null ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userDto.email)
        ) {
            throw new ApiError(ErrorMessage.EMAIL_INVALID);
        }
        if (userDto.password == null || userDto.password.length < 8) {
            throw new ApiError(ErrorMessage.PASSWORD_MUST_BE_8_CHARACTERS);
        }
        const existUser = await User.findOne({ email: userDto.email });
        const hashPassword = await this.hashPassword(userDto.password);

        if (existUser) {
            // User đã tồn tại và chưa bị xóa
            if (existUser.isDeleted === false) {
                throw new ApiError(ErrorMessage.USER_EXISTED);
            }

            // Kiểm tra lý do xóa
            if (
                existUser.deletedReason === DeletedReason.ADMIN_DELETED ||
                (existUser.isDeleted === true && !existUser.deletedReason)
            ) {
                throw new ApiError(ErrorMessage.USER_HAS_BEEN_DELETED);
            }

            // User đang pending verification - cho phép gửi lại OTP
            if (
                existUser.deletedReason === DeletedReason.PENDING_VERIFICATION
            ) {
                // Cập nhật thông tin user
                existUser.password = hashPassword;
                if (userDto.fullName) existUser.fullName = userDto.fullName;
                if (userDto.gender) existUser.gender = userDto.gender;
                if (userDto.dob) existUser.dob = userDto.dob;
                if (userDto.phoneNumber)
                    existUser.phoneNumber = userDto.phoneNumber;
                if (userDto.address) existUser.address = userDto.address;
                if (userDto.image) existUser.image = userDto.image;
                await existUser.save();

                await otpEmailService.sendOtp(
                    existUser.email,
                    OtpPurpose.REGISTER
                );
                return omit(existUser.toObject(), [
                    'password',
                    'isDeleted',
                    '__v',
                ]) as UserResponse;
            }
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
            deletedReason: DeletedReason.PENDING_VERIFICATION,
            role: Role.USER,
            credits: 100, // Add 100 credits for new user
        });
        const savedUser = await user.save();
        await otpEmailService.sendOtp(savedUser.email, OtpPurpose.REGISTER);

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
            role: Role.USER,
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
        user.deletedReason = DeletedReason.ADMIN_DELETED;
        await user.save();
    };

    public getAllUsers = async (
        page: number,
        limit: number,
        fields?: string,
        search?: string,
        gender?: string,
        includeDeleted?: string,
        sortBy?: string
    ) => {
        // Allowed fields for selection
        const allowedFields = [
            '_id',
            'fullName',
            'email',
            'gender',
            'dob',
            'phoneNumber',
            'address',
            'image',
            'credits',
            'createdAt',
            'updatedAt',
            'role',
            'isDeleted',
        ];

        let selectFields: string;

        if (fields) {
            const requestedFields = fields.split(',').map((f) => f.trim());
            const validFields = requestedFields.filter((f) =>
                allowedFields.includes(f)
            );

            if (validFields.length > 0) {
                selectFields = validFields.join(' ');
            } else {
                selectFields = '-password -__v';
            }
        } else {
            selectFields = '-password -__v';
        }

        // Build filter query
        const filter: Record<string, unknown> = {};

        // Handle deleted filter
        if (includeDeleted === 'true') {
            // Only show deleted users
            filter.isDeleted = true;
        } else {
            // Default: only show active users (not deleted)
            filter.isDeleted = false;
        }

        // Handle search
        if (search && search.trim()) {
            filter.$or = [
                { fullName: { $regex: search.trim(), $options: 'i' } },
                { email: { $regex: search.trim(), $options: 'i' } },
                { phoneNumber: { $regex: search.trim(), $options: 'i' } },
            ];
        }

        // Handle gender filter
        if (gender && gender !== 'all') {
            filter.gender = gender;
        }

        // Handle sorting
        let sortOptions: Record<string, 1 | -1> = { createdAt: -1 };
        if (sortBy) {
            switch (sortBy) {
                case 'name_asc':
                    sortOptions = { fullName: 1 };
                    break;
                case 'name_desc':
                    sortOptions = { fullName: -1 };
                    break;
                case 'email_asc':
                    sortOptions = { email: 1 };
                    break;
                case 'email_desc':
                    sortOptions = { email: -1 };
                    break;
                case 'credits_asc':
                    sortOptions = { credits: 1 };
                    break;
                case 'credits_desc':
                    sortOptions = { credits: -1 };
                    break;
                case 'date_asc':
                    sortOptions = { createdAt: 1 };
                    break;
                case 'date_desc':
                default:
                    sortOptions = { createdAt: -1 };
                    break;
            }
        }

        const result = await PaginationHelper.paginate(
            User,
            filter,
            { page, limit },
            [],
            selectFields,
            sortOptions
        );

        return {
            users: result.data,
            pagination: result.pagination,
        };
    };

    public getUserPreference = async (
        userId: string
    ): Promise<UserPreferences> => {
        const user = await User.findOne({
            _id: userId,
            isDeleted: false,
        }).select('preferences');
        if (!user) {
            throw new ApiError(ErrorMessage.USER_NOT_FOUND);
        }
        if (!user.preferences) {
            throw new ApiError(ErrorMessage.USER_PREFERENCE_NOT_FOUND);
        }
        return user.preferences;
    };

    public setUserPreferences = async (
        userId: string,
        preferencesData: SetUserPreferencesRequest
    ): Promise<UserPreferences> => {
        const user = await User.findOne({ _id: userId, isDeleted: false });
        if (!user) {
            throw new ApiError(ErrorMessage.USER_NOT_FOUND);
        }
        const updatedPreferences = {
            ...user.preferences,
            ...preferencesData,
            lastUpdated: new Date(),
        };

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { preferences: updatedPreferences },
            { new: true, runValidators: true }
        ).select('preferences');

        if (!updatedUser || !updatedUser.preferences) {
            throw new ApiError(ErrorMessage.UPDATE_USER_FAIL);
        }

        return updatedUser.preferences;
    };

    public restoreUser = async (id: string): Promise<UserResponse> => {
        const user = await User.findById(id);
        if (!user || !user.isDeleted) {
            throw new ApiError(ErrorMessage.USER_NOT_FOUND);
        }
        user.isDeleted = false;
        await user.save();
        return omit(user.toObject(), [
            'password',
            'isDeleted',
            '__v',
        ]) as UserResponse;
    };
}

export default UserService;
