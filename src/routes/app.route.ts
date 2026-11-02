import { Router } from "express";
import { indexApp } from "../controller/app.controller.ts";

const route = Router();

route.get("/", indexApp);

export default route;
