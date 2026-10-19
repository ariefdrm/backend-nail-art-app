import express, { type Request, type Response } from "express";

const app = express();

app.use(express.json());

app.get("/", (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    status: 200,
    message: "Hello World! Express.js + TypeScript + Bun",
    runtime: "Bun",
    framework: "Express.js",
  });
});

export default app;
