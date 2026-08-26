// Punto de entrada en Vercel: vercel.json reescribe todo a /api y Express atiende.
import { buildApp } from "../src/wiring.js";

export default buildApp();
