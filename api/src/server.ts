import { buildApp } from "./wiring.js";
import { loadConfig } from "./config.js";

const app = buildApp();
const { port } = loadConfig();
app.listen(port, () => console.log(`dayahead-api escuchando en http://localhost:${port}`));
