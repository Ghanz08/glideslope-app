import { handleIngestGmail } from "../_shared/core.js";
import { db } from "../_shared/db.ts";

Deno.serve((req) => handleIngestGmail(req, db, Deno.env.toObject()));
