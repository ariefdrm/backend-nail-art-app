import { fileURLToPath } from "node:url";
import express, { Router } from "express";
import helmet from "helmet";
import swaggerUiDist from "swagger-ui-dist";
import { docsGate } from "../middleware/docs-gate.js";

// documents/openapi.yaml is two levels up from both src/routes and dist/routes.
const SPEC_PATH = fileURLToPath(new URL("../../documents/openapi.yaml", import.meta.url));

const PAGE = `<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>The Nail Palace API</title>
    <link rel="stylesheet" href="assets/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="assets/swagger-ui-bundle.js"></script>
    <script src="initializer.js"></script>
  </body>
</html>
`;

// A separate file, not an inline script, so the CSP can stay at script-src 'self'.
const INITIALIZER = `window.ui = SwaggerUIBundle({ url: "openapi.yaml", dom_id: "#swagger-ui" });\n`;

// Interactive API docs generated from the contract. Mounted at /docs, outside /api/v1.
const docs = Router();

docs.use(docsGate);
// The Swagger UI bundle needs inline styles and data: images; nothing is loaded from other origins.
docs.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
      },
    },
  }),
);

docs.get("/", (req, res) => {
  // Relative asset URLs in the page need the trailing slash.
  if (!req.originalUrl.split("?")[0]?.endsWith("/")) {
    res.redirect(301, `${req.baseUrl}/`);
    return;
  }
  res.type("html").send(PAGE);
});
docs.get("/initializer.js", (_req, res) => {
  res.type("js").send(INITIALIZER);
});
docs.get("/openapi.yaml", (_req, res) => {
  res.type("application/yaml").sendFile(SPEC_PATH);
});
docs.use("/assets", express.static(swaggerUiDist.getAbsoluteFSPath()));

export default docs;
