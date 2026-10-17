import express from "express";

const app = express();

app.use(express.json());

app.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Hello World! Express.js + TypeScript + Bun is running ??",
    runtime: "Bun",
    framework: "Express.js",
  });
});

export default app;
