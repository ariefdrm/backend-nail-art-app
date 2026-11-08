import express, { type Express } from "express";
import { corsAllowlist, securityHeaders } from "./middleware/security.js";
import { errorHandler } from "./middleware/error-handler.js";
import { httpLogger } from "./middleware/http-logger.js";
import { notFound } from "./middleware/not-found.js";
import { requestId } from "./middleware/request-id.js";
import docsRoutes from "./routes/docs.routes.js";
import routes from "./routes/index.js";

// Builds the Express instance without calling listen(), so tests and the
// Node smoke test can import it without opening a port.
const app: Express = express();

app.disable("x-powered-by");
app.use(requestId);
app.use(httpLogger);
// The docs page brings its own, looser CSP, so it is mounted before the strict global headers.
app.use("/docs", docsRoutes);
app.use(securityHeaders);
// Before the routes, so a preflight is answered without auth and without counting against a rate limit.
app.use(corsAllowlist);
app.use(express.json({ limit: "100kb" }));
app.use(routes);
app.use(notFound);
app.use(errorHandler);

export default app;
