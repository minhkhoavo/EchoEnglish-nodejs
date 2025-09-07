import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { Model } from "mongoose";
import ApiResponse from "~/dto/response/api_response";
import { ErrorMessage } from "~/enum/error_message";
import { ApiError } from "./api_error";

const SECRET_KEY = process.env.JWT_SECRETKEY!;

const PUBLIC_ENDPOINTS: { methods: string[], path: string }[] = [
  { methods: ["POST"], path: "/auth/login" },
  { methods: ["POST"], path: "/auth/register" },
  { methods: ["POST"], path: "/auth/verify-register-otp" },
  { methods: ["POST"], path: "/auth/forgot-password" },
  { methods: ["POST"], path: "/auth/reset-password" },
  { methods: ["ALL"],  path: "/api/users/**" },   
  { methods: ["GET"],  path: "/tests/" },
  { methods: ["GET"], path: "/tests/**" },
  { methods: ["GET"],  path: "/category-flashcard/test/**" }, 
];

/* kiem tra PUBLIC_ENPOINT.path match req.path */
function matchesPattern(pattern: string, path: string): boolean {
  if (pattern.endsWith('/**')) {
    const base = pattern.slice(0, -3); 
    return path.startsWith(base);
  }
  const regexPattern = pattern
    .replace(/\*/g, '[^/]*') 
    .replace(/\//g, '\\/'); 
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(path);
}

function isPublicEndpoint(method: string,path: string): boolean {
  return PUBLIC_ENDPOINTS.some(entry => {
    const methodMatch = entry.methods.includes("ALL") || entry.methods.includes(method);
    return methodMatch && matchesPattern(entry.path, path);
  })
}

export function globalAuth(req: Request, res: Response, next: NextFunction){
  if(isPublicEndpoint(req.method, req.path)){
    return next();
  }
  return authenticateJWT(req, res, next);
}

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
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(ErrorMessage.UNAUTHORIZED);
    }

    const docId = req.params[idParam];
    const doc = await model.findById(docId).select("createBy");

    if (!doc) {
      throw new ApiError(ErrorMessage.NOTFOUND);
    }

    if (doc.createBy !== userId) {
      throw new ApiError(ErrorMessage.PERMISSION_DENIED);
    }

    next();
    
  };
}