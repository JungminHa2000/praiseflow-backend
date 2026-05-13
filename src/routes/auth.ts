import express, { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";

const router = express.Router();

// We'll store this in .env later, but for now this works.
// The JWT_SECRET is used to sign tokens — it's like a password
// that proves the token was created by YOUR server.
const JWT_SECRET = process.env.JWT_SECRET || "praiseflow-dev-secret-2024";

// -- SIGNUP --
// POST /api/auth/signup
// Creates a new user account
router.post("/signup", async (req: Request, res: Response) => {
  try {
    const { name, email, password, instrumentDefault, voiceType } = req.body;

    if (!name || !email || !password) {
      res.status(400).json({ error: "Name, email, and password are required" });
      return;
    }

    // Check if a user with this email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      res.status(400).json({ error: "An account with this email already exists" });
      return;
    }

    // Hash the password. bcrypt adds random "salt" and runs the
    // password through 10 rounds of hashing so even if someone
    // steals your database, they can't read the passwords.
    const passwordHash = await bcrypt.hash(password, 10);

    // Create the user
    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        instrumentDefault: instrumentDefault || null,
        voiceType: voiceType || null,
      },
    });

    // Create a default folder for the user so they have
    // somewhere to put songs immediately after signing up
    const defaultFolder = await prisma.folder.create({
      data: {
        name: "My Songs",
        userId: user.id,
      },
    });

    // Generate a JWT token. This is a signed string that contains
    // the user's ID. The frontend stores it and sends it with every
    // request to prove "I am this user".
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: "7d" } // token expires in 7 days
    );

    res.status(201).json({
      message: "Account created",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        instrumentDefault: user.instrumentDefault,
        voiceType: user.voiceType,
      },
      defaultFolderId: defaultFolder.id,
    });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ error: "Signup failed" });
  }
});

// -- LOGIN --
// POST /api/auth/login
// Authenticates an existing user
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    // Find the user by email
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    // Compare the entered password with the stored hash.
    // bcrypt.compare handles the salt automatically.
    const passwordMatch = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatch) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    // Generate a fresh token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Get the user's folders so the frontend knows where to put uploads
    const folders = await prisma.folder.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        instrumentDefault: user.instrumentDefault,
        voiceType: user.voiceType,
      },
      folders,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

export default router;