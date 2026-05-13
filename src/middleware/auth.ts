import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "praiseflow-dev-secret-2024";

// Extend Express's Request type to include our user info.
// This way TypeScript knows about req.userId in route handlers.
export interface AuthenticatedRequest extends Request {
  userId?: string;
  userEmail?: string;
}

// -- AUTH MIDDLEWARE --
// Add this to any route that requires a logged-in user.
// It reads the JWT token from the Authorization header,
// verifies it, and attaches the userId to the request object.
export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Not authenticated. Please log in." });
    return;
  }

  // The header looks like "Bearer eyJhbGci..."
  // We split on the space and take the second part (the actual token)
  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: string;
      email: string;
    };
    req.userId = decoded.userId;
    req.userEmail = decoded.email;
    next(); // continue to the actual route handler
  } catch (error) {
    res.status(401).json({ error: "Invalid or expired token. Please log in again." });
    return;
  }
}