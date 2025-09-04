import { UserCreateRequest } from "~/dto/request/iam/UserCreateRequest";
import { User, UserType } from "../models/user.model";
import bcrypt from "bcrypt";
import { ErrorMessage } from "~/enum/error_message";
import { OtpEmailService } from "./OtpEmailService";
import { OtpPurpose } from "~/enum/otp_purpose";
import { Role } from "~/models/role.model";
import { RoleName } from "~/enum/role";
import { log } from "console";

const otpService = new OtpEmailService();

class UserService {

  public getUserById = async (id: string)=>{
    return await User.findOne({ _id: id, isDeleted: false});
  }
  
  //get thong tin 
  public getProfile = async (email: string) => {
    return await User.findOne({email});
  }

  // Hàm đăng ký user
  public registerUser = async (userDto: UserCreateRequest) => {
  return User.findOne({ email: userDto.email })
    .then((existUser) => {
      return this.hashPassword(userDto.password).then((hashPassword) => {
        if (existUser) {
          if (existUser.isDeleted === false) {
            throw new Error(ErrorMessage.USER_EXISTED);
          }
          // user chưa active → gửi OTP mới
          return otpService.sendOtp(existUser.email, OtpPurpose.REGISTER).then(() => User.populate(existUser, {
              path: "roles",
              populate: { path: "permissions" }
            }));
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

            return user.save();
          });
      })
      .then((savedUser) => {
            // gửi OTP lần đầu
            return otpService.sendOtp(savedUser.email, OtpPurpose.REGISTER)
              .then(() => User.populate(savedUser, {
                path: "roles",
                populate: { path: "permissions" }
              }));
      });
    })
    .catch((err) => {
      throw err;
    });
  }
  
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
        })
        .then((savedUser) => {
            return User.populate(savedUser, {
              path: "roles",
              populate: { path: "permissions" }
            });
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

  // Hàm cập nhật user
  public updateUser = async (userId: string, request: Partial<UserType>) => {
    try{
      const user = await User.findOneAndUpdate({ _id: userId, isDeleted: false}, request, { new: true })
                              .select("-password -isDeleted -__v");
      console.log(user);
      if(!user){
        throw new Error(ErrorMessage.USER_NOT_FOUND);
      }
      return{
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
      }
    }
    catch(err){
      throw err;
    }
  }

  // Hàm cập nhật thông tin user
  public updateProfileUser = async (userId: string, request: Partial<UserType>) => {
    try{
      const user = await User.findOneAndUpdate({ _id: userId, isDeleted: false}, request, { new: true })
                              .select("-password -roles -isDeleted -__v"); // options { new: true } để trả về document mới nhất (sau khi update)
      console.log(user);
      if(!user){
        throw new Error(ErrorMessage.USER_NOT_FOUND);
      }
      return{
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        gender: user.gender,
        dob: user.dob,
        phoneNumber: user.phoneNumber,
        address: user.address,
        image: user.image,
      }
    }
    catch(err){
      throw err;
    }
  }

  // Hàm xóa mềm user
  public softDelete = async (userId: string) => {
    try{
      await User.findOneAndUpdate({_id: userId, isDeleted: false}, {isDeleted: true} , {new: true}).select("-password -roles -isDeleted -__v");
    }
    catch(err){
      throw err;
    }
  }

}

export default UserService;

