import { Router } from "express";
import route from "./app.route.ts";

const routes = Router();

routes.use(route);

export default routes;
