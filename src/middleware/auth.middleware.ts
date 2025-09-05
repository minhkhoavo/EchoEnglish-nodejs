import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { Model } from "mongoose";
import ApiResponse from "~/dto/response/ApiResponse";
import { ErrorMessage } from "~/enum/error_message";
import { ApiError } from "./api_error";

const SECRET_KEY = process.env.JWT_SECRETKEY!;

const PUBLIC_ENDPOINTS = [
  "/auth/login",
  "/auth/introspect", 
  "/auth/register",
  "/auth/verify-register-otp/**",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/api-docs",
  "/api/users/**",
  "/tests/",
  "/tests/**"
];

// Pattern matching giống Spring Security
function matchesPattern(pattern: string, path: string): boolean {
  // Nếu pattern kết thúc bằng /** thì match luôn cả path gốc không có /
  if (pattern.endsWith('/**')) {
    const base = pattern.slice(0, -3); // bỏ /**
    if (path === base) return true;
  }
  // Chuyển pattern Spring-style thành regex
  const regexPattern = pattern
    .replace(/\*\*/g, '.*')  // ** = match bất kỳ ký tự nào (bao gồm /)
    .replace(/\*/g, '[^/]*') // * = match bất kỳ ký tự nào trừ /
    .replace(/\//g, '\\/');  // Escape dấu / để dùng trong regex pattern
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(path);
}

// Kiểm tra xem path có phải là public endpoint không
function isPublicEndpoint(path: string): boolean {
  return PUBLIC_ENDPOINTS.some(pattern => matchesPattern(pattern, path));
}

//globalAuth
export function globalAuth(req: Request, res: Response, next: NextFunction){
  if(isPublicEndpoint(req.path)){
    return next();
  }
  return authenticateJWT(req, res, next);
}

//xac thuc jwt
export function authenticateJWT(req: Request, res: Response, next: NextFunction){
  const authHeader = req.headers.authorization;
  if(!authHeader?.startsWith("Bearer ")){
    return res.status(401).json(new ApiResponse("Missing or invalid Authorization header"));
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, SECRET_KEY) as jwt.JwtPayload;
    req.user = {
      id: decoded.userId || '',
      email: decoded.sub || '',
      scope: decoded.scope || '',
    };
    next();
  } catch (error) {
    return res.status(403).json(new ApiResponse("Invalid or expired token"));
  }
}

//middleware check role 
export function hasAuthority(...roles: string[]){
  return (req: Request, res: Response, next: NextFunction)=>{
    const user = req.user as any;
    if(!user || !user.scope){
      return res.status(403).json(new ApiResponse("Forbidden"));
    }

    const scopes = user.scope.split(" ");
    const hasRole = roles.some((r) => scopes.includes(r));

    if(!hasRole){
      return res.status(403).json(new ApiResponse("Insufficient permission"));
    }

    next();
  }

}

export function isOwn(model: Model<any>, idParam: string = "id") {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userEmail = req.user?.email; // Lấy email từ request
      if (!userEmail) {
        throw new ApiError(ErrorMessage.UNAUTHORIZED);
      }

      const docId = req.params[idParam];
      const doc = await model.findById(docId).select("createBy");

      if (!doc) {
        throw new ApiError(ErrorMessage.NOTFOUND);
      }

      if (doc.createBy !== userEmail) { // So sánh với email
        throw new ApiError(ErrorMessage.PERMISSION_DENIED);
      }

      next();
    } catch (err) {
      throw new ApiError(ErrorMessage.INTERNAL_ERROR);
    }
  };
}