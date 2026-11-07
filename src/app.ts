import express, { type Express } from "express";
import routes from "./routes/index.js";

// Builds the Express instance without calling listen(), so tests and the
// Node smoke test can import it without opening a port.
const app: Express = express();

app.use(express.json());
app.use(routes);

export default app;
