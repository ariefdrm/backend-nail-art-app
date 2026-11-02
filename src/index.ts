import express, { type Express } from "express";
import routes from "./routes/index.ts";

const app: Express = express();

const PORT = Number(process.env.PORT ?? 3000);

app.use(routes);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`?? Server running at http://localhost:${PORT}`);
});
