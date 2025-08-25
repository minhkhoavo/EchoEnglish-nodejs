import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import ApiResponse from "~/dto/response/ApiResponse";

const SECRET_KEY = process.env.JWT_SECRETKEY!;

const PUBLIC_ENDPOINTS = [
  "/auth/login",
  "/auth/introspect",
  "/auth/register",
  "/auth/verify-register-otp/**",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/api-docs",
  "/api/users/"
];

//globalAuth
export function globalAuth(req: Request, res: Response, next: NextFunction){
  if(PUBLIC_ENDPOINTS.includes(req.path)){
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
      id: decoded.userId,
      email: decoded.sub,
      scope: decoded.scope,
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