import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./libs/logger";

createApp().listen(env.PORT, () => {
  logger.info("API server started", { port: env.PORT, environment: env.NODE_ENV });
});
