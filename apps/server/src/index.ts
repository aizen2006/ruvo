import express from "express";
import cors from "cors";
import helmet from "helmet";
import { logger } from "./libs/logger";
import { requestLogger } from "./middlewares/requestLogger";
import { errorHandler } from "./middlewares/errorLogger";

const PORT = process.env.PORT ?? 3000;

const app = express();

app.use(cors());
app.use(helmet());

app.use(express.json());
app.use(requestLogger);
//routes
app.get("/health", ( _ , res ) => {
  logger.info("Health check requested");

  res.status(200).json({
    status: "ok",
  });
});

// error handling
app.use(errorHandler);

app.listen(PORT,( )=>{
    logger.info("Server started", {
    port: 3000,
    environment: process.env.NODE_ENV,
  });
})