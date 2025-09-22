import { UserCreateRequest } from '~/dto/request/iam/userCreateRequest.js';
import { User, UserType } from '../models/userModel.js';
import bcrypt from 'bcrypt';
import { ErrorMessage } from '~/enum/errorMessage.js';
import { OtpEmailService } from './otpEmailService.js';
import { OtpPurpose } from '~/enum/otpPurpose.js';
import { Role, RoleType } from '~/models/roleModel.js';
import { RoleName } from '~/enum/role.js';
import { ApiError } from '~/middleware/apiError.js';
import { error } from 'console';
import { List } from 'microsoft-cognitiveservices-speech-sdk/distrib/lib/src/common/List.js';
import { Types } from 'mongoose';

const otpService = new OtpEmailService();

class UserService {
  public getUserById = async (id: string) => {
    return await User.findOne({ _id: id, isDeleted: false });
  };

  public getProfile = async (email: string) => {
    return await User.findOne({ email });
  };

  public registerUser = async (userDto: UserCreateRequest) => {
    return User.findOne({ email: userDto.email })
      .then((existUser) => {
        return this.hashPassword(userDto.password)
          .then((hashPassword) => {
            if (existUser) {
              if (existUser.isDeleted === false) {
                throw new ApiError(ErrorMessage.USER_EXISTED);
              }
              return otpService
                .sendOtp(existUser.email, OtpPurpose.REGISTER)
                .then(() =>
                  User.populate(existUser, {
                    path: 'roles',
                    populate: { path: 'permissions' },
                  })
                );
            }

            return Role.findOne({ name: RoleName.USER })
              .populate('permissions')
              .exec()
              .then((userRole) => {
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
                  roles: [userRole._id], // lưu ObjectId
                });

                return user.save();
              });
          })
          .then((savedUser) => {
            return otpService
              .sendOtp(savedUser.email, OtpPurpose.REGISTER)
              .then(() =>
                User.populate(savedUser, {
                  path: 'roles',
                  populate: { path: 'permissions' },
                })
              );
          });
      })
      .catch((err) => {
        throw err;
      });
  };

  public createUser = async (userDto: UserCreateRequest) => {
    return this.hashPassword(userDto.password)
      .then((hashPassword) => {
        return User.findOne({ email: userDto.email })
          .then((existUser) => {
            if (existUser) {
              if (existUser.isDeleted === false) {
                throw new ApiError(ErrorMessage.USER_EXISTED);
              }
              existUser.isDeleted = false;
              existUser.password = hashPassword;
              return existUser.save();
            }

            return Role.findOne({ name: RoleName.USER })
              .populate('permissions')
              .exec()
              .then((userRole) => {
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
                  roles: [userRole._id], // lưu ObjectId
                });
                return user.save();
              });
          })
          .then((savedUser) => {
            return User.populate(savedUser, {
              path: 'roles',
              populate: { path: 'permissions' },
            });
          });
      })
      .catch((err) => {
        throw err;
      });
  };

  public hashPassword = async (password: string): Promise<string> => {
    const saltRounds = 10;
    const salt = bcrypt.genSaltSync(saltRounds);
    return bcrypt.hashSync(password, salt);
  };

  public resetPassword = async (email: string, newPassword: string) => {
    return User.findOne({ email: email, isDeleted: false })
      .then((user) => {
        if (!user) {
          throw new ApiError(ErrorMessage.USER_NOT_FOUND);
        }
        return this.hashPassword(newPassword).then((hashPassword) => {
          user.password = hashPassword;
          return user.save();
        });
      })
      .catch((err) => {
        throw err;
      });
  };

  public updateUser = async (userId: string, request: Partial<UserType>) => {
    const user = await User.findOneAndUpdate(
      { _id: userId, isDeleted: false },
      request,
      { new: true }
    ).select('-password -isDeleted -__v');
    if (!user) {
      throw new ApiError(ErrorMessage.USER_NOT_FOUND);
    }

    return User.findOne({ email: user.email, isDeleted: false })
      .then((user) => {
        if (!user) {
          throw new ApiError(ErrorMessage.USER_NOT_FOUND);
        }
        return {
          id: user._id,
          fullName: user.fullName,
          gender: user.gender,
          dob: user.dob,
          email: user.email,
          phoneNumber: user.phoneNumber,
          address: user.address,
          image: user.image,
          roles: user.roles,
          createBy: user.createBy,
          updateBy: user.updateBy,
        };
      })
      .catch((error) => {
        throw error;
      });
  };

  public updateProfileUser = async (
    userId: string,
    request: Partial<UserType>
  ) => {
    const user = await User.findOneAndUpdate(
      { _id: userId, isDeleted: false },
      request,
      { new: true }
    ).select('-password -roles -isDeleted -__v'); // options { new: true } để trả về document mới nhất (sau khi update)
    if (!user) {
      throw new ApiError(ErrorMessage.USER_NOT_FOUND);
    }
    return {
      id: user._id,
      fullName: user.fullName,
      email: user.email,
      gender: user.gender,
      dob: user.dob,
      phoneNumber: user.phoneNumber,
      address: user.address,
      image: user.image,
    };
  };

  public softDelete = async (userId: string) => {
    await User.findByIdAndUpdate(userId, { isDeleted: true }, { new: true });
  };

  public isAdmin = async (userScope: string) => {
    const roles = await Role.find({ _id: userScope });
    const isAdmin = roles.some((role: RoleType) => role.name === 'ADMIN');
    return isAdmin;
  };
}

export default UserService;
