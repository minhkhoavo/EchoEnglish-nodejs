import { Gender } from "~/enum/gender";
import { RoleType } from "~/models/role.model";

export class UserResponse {
    userId?: string;
    fullName!: string;
    gender!: Gender;
    dob!: Date; 
    email!: string;
    phoneNumber?: string;
    address?: string;
    image?: string;
    roles?: RoleType[];

    createdAt?: string;
    createBy?: string;
    updateAt?: string;
    updateBy?: string;

    constructor(data: Partial<UserResponse>) {
        Object.assign(this, data);
    }
}