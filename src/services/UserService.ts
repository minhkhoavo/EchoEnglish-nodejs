import { User, UserType } from "../models/user.model";

export async function createUser(data: Partial<UserType>) {
  const user = new User(data);
  return await user.save();
}