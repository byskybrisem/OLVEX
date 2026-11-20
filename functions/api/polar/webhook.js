import { handle, json } from "../../_lib/http.js";
import { polarWebhook } from "../../_lib/polar-billing.js";

export const onRequestPost = handle(async context => json(await polarWebhook(context)));
