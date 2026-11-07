import { Router } from "express";
import { login, logout, logoutAll, me, refresh } from "../controllers/auth.controller.js";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { loginSchemas, logoutSchemas, refreshSchemas } from "../schemas/auth.schema.js";

const auth = Router();

auth.post("/login", validate(loginSchemas), login);
auth.post("/refresh", validate(refreshSchemas), refresh);
auth.post("/logout", validate(logoutSchemas), logout);
auth.post("/logout-all", authenticate, logoutAll);
auth.get("/me", authenticate, me);

export default auth;
