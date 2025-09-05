export class UserCreateRequest {
  private _email!: string;
  private _fullName!: string;
  private _password!: string;
  private _gender!: string;
  private _dob!: string;
  private _phoneNumber?: string;
  private _address?: string;
  private _image?: string;

  constructor(data: Partial<UserCreateRequest>) {
    Object.assign(this, data); 
  }

  get email(): string {
    return this._email;
  }
  set email(value: string) {
    this._email = value;
  }

  get fullName(): string {
    return this._fullName;
  }
  set fullName(value: string) {
    this._fullName = value;
  }

  get password(): string {
    return this._password;
  }
  set password(value: string) {
    this._password = value;
  }

  get gender(): string {
    return this._gender;
  }
  set gender(value: string) {
    this._gender = value;
  }

  get dob(): string {
    return this._dob;
  }
  set dob(value: string) {
    this._dob = value;
  }

  get phoneNumber(): string | undefined {
    return this._phoneNumber;
  }
  set phoneNumber(value: string | undefined) {
    this._phoneNumber = value;
  }

  get address(): string | undefined {
    return this._address;
  }
  set address(value: string | undefined) {
    this._address = value;
  }

  get image(): string | undefined {
    return this._image;
  }
  set image(value: string | undefined) {
    this._image = value;
  }
}