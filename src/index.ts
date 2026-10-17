import app from "./services/app.service.ts";

const PORT = Number(process.env.PORT ?? 3000);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`?? Server running at http://localhost:${PORT}`);
});
