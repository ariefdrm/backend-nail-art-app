import { Router } from "express";

const health = Router();

// Liveness only for now; readiness should also check the database once
// the Prisma client is wired up.
health.get("/live", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

export default health;
