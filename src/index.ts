import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import uploadRouter from "./routes/upload";
import testRouter from "./routes/test";
import analyseRouter from "./routes/analyse";
import improvRouter from "./routes/improv";
import authRouter from "./routes/auth";
import libraryRouter from "./routes/library";
import piecesRouter from "./routes/pieces";
import shareRouter from "./routes/share";
import path from "path";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
// Serve uploaded files so the frontend can display them.
// A file at uploads/my-song.pdf becomes accessible at
// http://localhost:3000/uploads/my-song.pdf
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// Routes
// All upload endpoints will be at /api/upload
app.use("/api/upload", uploadRouter);
app.use("/api/test", testRouter);
app.use("/api/analyse", analyseRouter);
app.use("/api/improv", improvRouter);
app.use("/api/auth", authRouter);
app.use("/api/library", libraryRouter);
app.use("/api/pieces", piecesRouter);
app.use("/api/share", shareRouter);

app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "PraiseFlow API is running" });
});

app.listen(PORT, () => {
  console.log(`PraiseFlow server running on http://localhost:${PORT}`);
});