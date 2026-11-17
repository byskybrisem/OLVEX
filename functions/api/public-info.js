import { json } from "../_lib/http.js";
import { publicInfo } from "../_lib/public-info.js";

export function onRequestGet({ env, request }) {
  return json(publicInfo(env, request));
}
