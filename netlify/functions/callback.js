import { json } from "../lib/suno.js";

// Suno requires a callBackUrl. The app polls /api/status for results,
// so this endpoint just acknowledges the callback.
export default async () => json({ received: true });
