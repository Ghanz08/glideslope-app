import { handleProcessLlmJobs } from "../_shared/core.js";
import { db } from "../_shared/db.ts";

Deno.serve((req) => handleProcessLlmJobs(req, db, Deno.env.toObject()));
