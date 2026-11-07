import { Router } from "express";
import { indexApp } from "../controllers/app.controller.js";

const route = Router();

route.get("/", indexApp);

export default route;
