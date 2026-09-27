import { createApp } from "./app";
import { logger } from "./libs/logger";

const PORT = Number(process.env.PORT ?? 3000);

createApp().listen(PORT, () => {
  logger.info("API server started", { port: PORT, environment: process.env.NODE_ENV });
});
