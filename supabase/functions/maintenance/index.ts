import { handleMaintenance } from "../_shared/core.js";
import { db } from "../_shared/db.ts";

Deno.serve((req) => handleMaintenance(req, db, Deno.env.toObject()));
