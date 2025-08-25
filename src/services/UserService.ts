import { UserCreateRequest } from "~/dto/request/iam/UserCreateRequest";
import { User } from "../models/user.model";
import bcrypt from "bcrypt";
import { ErrorMessage } from "~/enum/error_message";
import { OtpEmailService } from "./OtpEmailService";
import { OtpPurpose } from "~/enum/otp_purpose";
import { Role } from "~/models/role.model";
import { RoleName } from "~/enum/role";

const otpService = new OtpEmailService();

class UserService {
  //get thong tin 
  public getProfile = async (email: string) => {
    return await User.findOne({email});
  }

  // Hàm đăng ký user
  public registerUser = (userDto: UserCreateRequest) => {
  return User.findOne({ email: userDto.email })
    .then((existUser) => {
      return this.hashPassword(userDto.password).then((hashPassword) => {
        if (existUser) {
          if (existUser.isDeleted === false) {
            throw new Error(ErrorMessage.USER_EXISTED);
          }
          // user chưa active → gửi OTP mới
          return otpService.sendOtp(existUser.email, OtpPurpose.REGISTER).then(() => existUser);
        }

        // lấy role USER trong DB
        return Role.findOne({ name: RoleName.USER })
          .populate("permissions")
          .exec()
          .then((userRole) => {
            if (!userRole) {
              throw new Error(ErrorMessage.ROLE_NOT_FOUND);
            }

            // tạo user mới
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

            return user.save().then((savedUser) => {
              // gửi OTP lần đầu
              return otpService
                .sendOtp(savedUser.email, OtpPurpose.REGISTER)
                .then(() =>
                  savedUser.populate({
                    path: "roles",
                    populate: { path: "permissions" },
                  })
                );
            });
          });
      });
    })
    .catch((err) => {
      throw err;
    });
  };
  
  // Hàm tạo user
  public createUser = async (userDto: UserCreateRequest) => {
    return this.hashPassword(userDto.password)
      .then((hashPassword) => {
        return User.findOne({ email: userDto.email }).then((existUser) => {
          if (existUser) {
            if (existUser.isDeleted === false) {
              throw new Error(ErrorMessage.USER_EXISTED);
            }
            // Nếu user đã bị xóa mềm, active lại user này
            existUser.isDeleted = false;
            existUser.password = hashPassword;
            return existUser.save();
          }

          return Role.findOne({ name: RoleName.USER })
          .populate("permissions")
          .exec()
          .then(userRole =>{
            if(!userRole){
              throw new Error(ErrorMessage.ROLE_NOT_FOUND);
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
          })
          
        });
      })
      .catch((err) => {
        throw err;
      });
  }

  // Hàm băm mật khẩu bcrypt
  public hashPassword = async (password: string): Promise<string> => {
    const saltRounds = 10;
    const salt = bcrypt.genSaltSync(saltRounds);
    return bcrypt.hashSync(password, salt);
  }

  // Hàm đặt lại mật khẩu
  public resetPassword = async (email: string, newPassword: string) => {
  return User.findOne({ email: email, isDeleted: false })
    .then((user) => {
      if (!user) {
        throw new Error(ErrorMessage.USER_NOT_FOUND);
      }
      return this.hashPassword(newPassword).then((hashPassword) => {
        user.password = hashPassword;
        return user.save();
      });
    })
    .catch((err) => {
      throw err;
    });
  }
}

export default UserService;

